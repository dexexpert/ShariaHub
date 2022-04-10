//SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../reputation/ShariaHubReputationInterface.sol";
import "../ShariaHubBase.sol";

contract ShariaHubLending is ShariaHubBase, Ownable, Pausable {
    using SafeMath for uint256;
    uint256 public minContribAmount = 0.1 ether;                          // 0.01 ether
    enum LendingState {
        Uninitialized,
        AcceptingContributions,
        ExchangingToFiat,
        AwaitingReturn,
        ProjectNotFunded,
        ContributionReturned,
        Default
    }
    
    mapping(address => Investor) public investors;
    uint256 public investorCount;
    uint256 public fundingStartTime;                                     // Start time of contribution period in UNIX time
    uint256 public fundingEndTime;                                       // End time of contribution period in UNIX time
    uint256 public totalContributed;
    bool public capReached;
    LendingState public state;
    uint256 public annualInterest;
    uint256 public totalLendingAmount;
    uint256 public lendingDays;
    uint256 public initialEthPerFiatRate;
    uint256 public totalLendingFiatAmount;
    address public borrower;
    address public localNode;
    address public ShariaHubTeam;
    uint256 public borrowerReturnDate;
    uint256 public borrowerReturnEthPerFiatRate;
    uint256 public constant ShariahubFee = 3;
    uint256 public constant localNodeFee = 4;
    uint256 public tier;
    // interest rate is using base uint 100 and 100% 10000, this means 1% is 100
    // this guarantee we can have a 2 decimal presicion in our calculation
    uint256 public constant interestBaseUint = 100;
    uint256 public constant interestBasePercent = 10000;
    bool public localNodeFeeReclaimed;
    bool public ShariaHubTeamFeeReclaimed;
    uint256 public surplusEth;
    uint256 public returnedEth;

    struct Investor {
        uint256 amount;
        bool isCompensated;
        bool surplusEthReclaimed;
    }

    // events
    event onCapReached(uint endTime);
    event onContribution(uint totalContributed, address indexed investor, uint amount, uint investorsCount);
    event onCompensated(address indexed contributor, uint amount);
    event onSurplusSent(uint256 amount);
    event onSurplusReclaimed(address indexed contributor, uint amount);
    event StateChange(uint state);
    event onInitalRateSet(uint rate);
    event onReturnRateSet(uint rate);
    event onReturnAmount(address indexed borrower, uint amount);

    // modifiers
    modifier checkProfileRegistered(string memory profile) {
        bool isRegistered = ShariaHubStorage.getBool(keccak256(abi.encodePacked("user", profile, msg.sender)));
        require(isRegistered);
        _;
    }

    modifier onlyOwner() {
        require( owner() == msg.sender, "must be owner");
        _;
    }

    constructor(
        uint256 _fundingStartTime,
        uint256 _fundingEndTime,
        address _borrower,
        uint256 _annualInterest,
        uint256 _totalLendingAmount,
        uint256 _lendingDays,
        address _storageAddress,
        address _localNode,
        address _ShariaHubTeam
        )
        ShariaHubBase(_storageAddress)
         {
        require(_fundingStartTime > block.timestamp);
        require(_fundingEndTime > fundingStartTime);
        require(_borrower != address(0));
        require(ShariaHubStorage.getBool(keccak256(abi.encodePacked("user", "representative", _borrower))));
        require(_localNode != address(0));
        require(_ShariaHubTeam != address(0));
        require(ShariaHubStorage.getBool(keccak256(abi.encodePacked("user", "localNode", _localNode))));
        require(_totalLendingAmount > 0);
        require(_lendingDays > 0);
        require(_annualInterest > 0 && _annualInterest < 100);
        version = 1;
        fundingStartTime = _fundingStartTime;
        fundingEndTime = _fundingEndTime;
        localNode = _localNode;
        ShariaHubTeam = _ShariaHubTeam;
        borrower = _borrower;
        annualInterest = _annualInterest;
        totalLendingAmount = _totalLendingAmount;
        lendingDays = _lendingDays;
        state = LendingState.Uninitialized;
    }

    function saveInitialParametersToStorage(uint256 _maxDelayDays, uint256 _tier, uint256 _communityMembers, address _community) external onlyOwner {
        require(_maxDelayDays != 0);
        require(state == LendingState.Uninitialized);
        require(_tier > 0);
        require(_communityMembers >= 20);
        require(ShariaHubStorage.getBool(keccak256(abi.encodePacked("user", "community", _community))));
        ShariaHubStorage.setUint(keccak256(abi.encodePacked("lending.maxDelayDays", this)), _maxDelayDays);
        ShariaHubStorage.setAddress(keccak256(abi.encodePacked("lending.community", this)), _community);
        ShariaHubStorage.setAddress(keccak256(abi.encodePacked("lending.localNode", this)), localNode);
        ShariaHubStorage.setUint(keccak256(abi.encodePacked("lending.tier", this)), _tier);
        ShariaHubStorage.setUint(keccak256(abi.encodePacked("lending.communityMembers", this)), _communityMembers);
        tier = _tier;
        state = LendingState.AcceptingContributions;
        emit StateChange(uint(state));

    }

    receive() external payable whenNotPaused {
        require(state == LendingState.AwaitingReturn || state == LendingState.AcceptingContributions || state == LendingState.ExchangingToFiat);
        if(state == LendingState.AwaitingReturn) {
            returnBorrowedEth();
        } else if (state == LendingState.ExchangingToFiat) {
            // borrower can send surplus eth back to contract to avoid paying interest
            sendBackSurplusEth();
        } else {
            contributeWithAddress(msg.sender);
        }
    }


    function sendBackSurplusEth() internal {
        require(state == LendingState.ExchangingToFiat);
        surplusEth = surplusEth.add(msg.value);
        require(surplusEth <= totalLendingAmount);
        emit onSurplusSent(msg.value);
    }

    /**
     * After the contribution period ends unsuccesfully, this method enables the contributor
     *  to retrieve their contribution
     */
    function declareProjectNotFunded() external onlyOwner {
        require(totalContributed < totalLendingAmount);
        require(state == LendingState.AcceptingContributions);
        require(block.timestamp > fundingEndTime);
        state = LendingState.ProjectNotFunded;
        emit StateChange(uint(state));
    }

    function declareProjectDefault() external onlyOwner {
        require(state == LendingState.AwaitingReturn);
        uint maxDelayDays = getMaxDelayDays();
        require(getDelayDays(block.timestamp) >= maxDelayDays);
        ShariaHubReputationInterface reputation = ShariaHubReputationInterface(ShariaHubStorage.getAddress(keccak256(abi.encodePacked("contract.name", "reputation"))));
        require(address(reputation) != address(0));
        ShariaHubStorage.setUint(keccak256(abi.encodePacked("lending.delayDays", this)), maxDelayDays);
        reputation.burnReputation(maxDelayDays);
        state = LendingState.Default;
        emit StateChange(uint(state));
    }

    function setBorrowerReturnEthPerFiatRate(uint256 _borrowerReturnEthPerFiatRate) external onlyOwner {
        require(state == LendingState.AwaitingReturn);
        borrowerReturnEthPerFiatRate = _borrowerReturnEthPerFiatRate;
        emit onReturnRateSet(borrowerReturnEthPerFiatRate);
    }

    function finishInitialExchangingPeriod(uint256 _initialEthPerFiatRate) external onlyOwner {
        require(capReached == true);
        require(state == LendingState.ExchangingToFiat);
        initialEthPerFiatRate = _initialEthPerFiatRate;
        if (surplusEth > 0) {
            totalLendingAmount = totalLendingAmount.sub(surplusEth);
        }
        totalLendingFiatAmount = totalLendingAmount.mul(initialEthPerFiatRate);
        emit onInitalRateSet(initialEthPerFiatRate);
        state = LendingState.AwaitingReturn;
        emit StateChange(uint(state));
    }

    /**
     * Method to reclaim contribution after project is declared default (% of partial funds)
     * @param  beneficiary the contributor
     *
     */
    function reclaimContributionDefault(address beneficiary) external {
        require(state == LendingState.Default);
        require(!investors[beneficiary].isCompensated);
        // contribution = contribution * partial_funds / total_funds
        uint256 contribution = checkInvestorReturns(beneficiary);
        require(contribution > 0);
        investors[beneficiary].isCompensated = true;
        payable(beneficiary).transfer(contribution);
    }

    /**
     * Method to reclaim contribution after a project is declared as not funded
     * @param  beneficiary the contributor
     *
     */
    function reclaimContribution(address beneficiary) external {
        require(state == LendingState.ProjectNotFunded);
        require(!investors[beneficiary].isCompensated);
        uint256 contribution = investors[beneficiary].amount;
        require(contribution > 0);
        investors[beneficiary].isCompensated = true;
        payable(beneficiary).transfer(contribution);
    }

    function reclaimSurplusEth(address beneficiary) external {
        require(surplusEth > 0);
        // only can be reclaimed after cap reduced
        require(state != LendingState.ExchangingToFiat);
        require(!investors[beneficiary].surplusEthReclaimed);
        uint256 surplusContribution = investors[beneficiary].amount.mul(surplusEth).div(surplusEth.add(totalLendingAmount));
        require(surplusContribution > 0);
        investors[beneficiary].surplusEthReclaimed = true;
        emit onSurplusReclaimed(beneficiary, surplusContribution);
        payable(beneficiary).transfer(surplusContribution);
    }

    function reclaimContributionWithInterest(address beneficiary) external {
        require(state == LendingState.ContributionReturned);
        require(!investors[beneficiary].isCompensated);
        uint256 contribution = checkInvestorReturns(beneficiary);
        require(contribution > 0);
        investors[beneficiary].isCompensated = true;
        payable(beneficiary).transfer(contribution);
    }

    function reclaimLocalNodeFee() external {
        require(state == LendingState.ContributionReturned);
        require(localNodeFeeReclaimed == false);
        uint256 fee = totalLendingFiatAmount.mul(localNodeFee).mul(interestBaseUint).div(interestBasePercent).div(borrowerReturnEthPerFiatRate);
        require(fee > 0);
        localNodeFeeReclaimed = true;
        payable(localNode).transfer(fee);
    }

    function reclaimShariaHubTeamFee() external {
        require(state == LendingState.ContributionReturned);
        require(ShariaHubTeamFeeReclaimed == false);
        uint256 fee = totalLendingFiatAmount.mul(ShariahubFee).mul(interestBaseUint).div(interestBasePercent).div(borrowerReturnEthPerFiatRate);
        require(fee > 0);
        ShariaHubTeamFeeReclaimed = true;
        payable(ShariaHubTeam).transfer(fee);
    }

    function returnBorrowedEth() internal {
        require(state == LendingState.AwaitingReturn);
        require(borrowerReturnEthPerFiatRate > 0);
        bool projectRepayed = false;
        uint excessRepayment = 0;
        uint newReturnedEth = 0;
        emit onReturnAmount(msg.sender, msg.value);
        (newReturnedEth, projectRepayed, excessRepayment) = calculatePaymentGoal(
                                                                                    borrowerReturnAmount(),
                                                                                    returnedEth,
                                                                                    msg.value);
        returnedEth = newReturnedEth;
        if (projectRepayed == true) {
            state = LendingState.ContributionReturned;
            emit StateChange(uint(state));
            updateReputation();
        }
        if (excessRepayment > 0) {
            payable(msg.sender).transfer(excessRepayment);
        }
    }

    // @notice Function to participate in contribution period
    //  Amounts from the same address should be added up
    //  If cap is reached, end time should be modified
    //  Funds should be transferred into multisig wallet
    // @param contributor Address
    function contributeWithAddress(address contributor) internal checkProfileRegistered('investor') whenNotPaused {
        require(state == LendingState.AcceptingContributions);
        require(msg.value >= minContribAmount);
        require(isContribPeriodRunning());

        uint oldTotalContributed = totalContributed;
        uint newTotalContributed = 0;
        uint excessContribValue = 0;
        (newTotalContributed, capReached, excessContribValue) = calculatePaymentGoal(
                                                                                    totalLendingAmount,
                                                                                    oldTotalContributed,
                                                                                    msg.value);
        totalContributed = newTotalContributed;
        if (capReached) {
            fundingEndTime = block.timestamp;
            emit onCapReached(fundingEndTime);
        }
        if (investors[contributor].amount == 0) {
            investorCount = investorCount.add(1);
        }
        investors[contributor].amount = investors[contributor].amount.add(msg.value);

        if (excessContribValue > 0) {
            payable(msg.sender).transfer(excessContribValue);
        }
        emit onContribution(newTotalContributed, contributor, msg.value, investorCount);
    }

    function calculatePaymentGoal(uint goal, uint oldTotal, uint contribValue) internal pure returns(uint, bool, uint) {
        uint newTotal = oldTotal.add(contribValue);
        bool goalReached = false;
        uint excess = 0;
        if (newTotal >= goal &&
            oldTotal < goal) {
            goalReached = true;
            excess = newTotal.sub(goal);
            contribValue = contribValue.sub(excess);
            newTotal = goal;
        }
        return (newTotal, goalReached, excess);
    }

    function sendFundsToBorrower() external onlyOwner {
      //Waiting for Exchange
        require(state == LendingState.AcceptingContributions);
        require(capReached);
        state = LendingState.ExchangingToFiat;
        emit StateChange(uint(state));
        payable(borrower).transfer(totalContributed);
    }

    function updateReputation() internal {
        uint delayDays = getDelayDays(block.timestamp);
        ShariaHubReputationInterface reputation = ShariaHubReputationInterface(ShariaHubStorage.getAddress(keccak256(abi.encodePacked("contract.name", "reputation"))));
        require(address(reputation) != address(0));
        if (delayDays > 0) {
            ShariaHubStorage.setUint(keccak256(abi.encodePacked("lending.delayDays", this)), delayDays);
            reputation.burnReputation(delayDays);
        } else {
            uint completedProjectsByTier  = ShariaHubStorage.getUint(keccak256(abi.encodePacked("community.completedProjectsByTier", this, tier))).add(1);
            ShariaHubStorage.setUint(keccak256(abi.encodePacked("community.completedProjectsByTier", this, tier)), completedProjectsByTier);
            reputation.incrementReputation(completedProjectsByTier);
        }
    }

    function getDelayDays(uint date) public view returns(uint) {
        uint lendingDaysSeconds = lendingDays * 1 days;
        uint defaultTime = fundingEndTime.add(lendingDaysSeconds);
        if (date < defaultTime) {
            return 0;
        } else {
            return date.sub(defaultTime).div(60).div(60).div(24);
        }
    }

    // lendingInterestRate with 2 decimal
    // 15 * (lending days)/ 365 + 4% local node fee + 3% LendingDev fee
    function lendingInterestRatePercentage() public view returns(uint256){
        return annualInterest.mul(interestBaseUint).mul(lendingDays.add(getDelayDays(block.timestamp))).div(365).add(localNodeFee.mul(interestBaseUint)).add(ShariahubFee.mul(interestBaseUint)).add(interestBasePercent);
    }

    // lendingInterestRate with 2 decimal
    function investorInterest() public view returns(uint256){
        return annualInterest.mul(interestBaseUint).mul(lendingDays.add(getDelayDays(block.timestamp))).div(365).add(interestBasePercent);
    }

    function borrowerReturnFiatAmount() public view returns(uint256) {
        return totalLendingFiatAmount.mul(lendingInterestRatePercentage()).div(interestBasePercent);
    }

    function borrowerReturnAmount() public view returns(uint256) {
        return borrowerReturnFiatAmount().div(borrowerReturnEthPerFiatRate);
    }

    function isContribPeriodRunning() public view returns(bool) {
        return fundingStartTime <= block.timestamp && fundingEndTime > block.timestamp && !capReached;
    }

    function checkInvestorContribution(address investor) public view returns(uint256){
        return investors[investor].amount;
    }

    function checkInvestorReturns(address investor) public view returns(uint256) {
        uint256 investorAmount = 0;
        if (state == LendingState.ContributionReturned) {
            investorAmount = investors[investor].amount;
            if (surplusEth > 0){
                investorAmount  = investors[investor].amount.mul(totalLendingAmount).div(totalContributed);
            }
            return investorAmount.mul(initialEthPerFiatRate).mul(investorInterest()).div(borrowerReturnEthPerFiatRate).div(interestBasePercent);
        } else if (state == LendingState.Default){
            investorAmount = investors[investor].amount;
            // contribution = contribution * partial_funds / total_funds
            return investorAmount.mul(returnedEth).div(totalLendingAmount);
        } else {
            return 0;
        }
    }

    function getMaxDelayDays() public view returns(uint256){
        return ShariaHubStorage.getUint(keccak256(abi.encodePacked("lending.maxDelayDays", this)));
    }
}
