'use strict';
import ether from './helpers/ether'
import {advanceBlock} from './helpers/advanceToBlock'
import {increaseTimeTo, duration} from './helpers/increaseTime'
import latestTime from './helpers/latestTime'
import EVMRevert from './helpers/EVMRevert'

const BigNumber = web3.BigNumber
const web3_1_0 = require('web3');
const utils = web3_1_0.utils;
const Uninitialized = 0;
const AcceptingContributions = 1;
const ExchangingToFiat = 2;
const AwaitingReturn = 3;
const ProjectNotFunded = 4;
const ContributionReturned = 5;
const Default = 6;

const should = require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()


const ShariaHubLending = artifacts.require('ShariaHubLending');
const MockStorage = artifacts.require('./helper_contracts/MockStorage.sol');
const MockReputation = artifacts.require('./helper_contracts/MockReputation.sol');

contract('ShariaHubLending', function ([owner, borrower, investor, investor2, investor3, investor4, investor5, localNode, ShariaHubTeam, community]) {
    beforeEach(async function () {
        await advanceBlock();
        this.fundingStartTime = latestTime() + duration.days(1);
        this.fundingEndTime = this.fundingStartTime + duration.days(40);
        this.lendingInterestRatePercentage = 15;
        this.totalLendingAmount = ether(3);
        this.tier = 1;
        this.ShariahubFee = 3;
        this.localNodeFee = 4;
        //400 pesos per eth
        this.initialEthPerFiatRate = 400;
        this.finalEthPerFiatRate = 480;
        this.lendingDays = 90;
        this.delayMaxDays = 90;
        this.members = 20;
        this.mockStorage = await MockStorage.new();
        this.mockReputation = await MockReputation.new();
        await this.mockStorage.setAddress(utils.soliditySha3("contract.name", "reputation"),this.mockReputation.address);
        await this.mockStorage.setBool(utils.soliditySha3("user", "localNode",localNode),true);
        await this.mockStorage.setBool(utils.soliditySha3("user", "representative",borrower),true);

        this.lending = await ShariaHubLending.new(
                                                this.fundingStartTime,
                                                this.fundingEndTime,
                                                borrower,
                                                this.lendingInterestRatePercentage,
                                                this.totalLendingAmount,
                                                this.lendingDays,
                                                this.mockStorage.address,
                                                localNode,
                                                ShariaHubTeam
                                            );

        await this.mockStorage.setBool(utils.soliditySha3("user", "investor",investor),true);
        await this.mockStorage.setBool(utils.soliditySha3("user", "investor",investor2),true);
        await this.mockStorage.setBool(utils.soliditySha3("user", "investor",investor3),true);
        await this.mockStorage.setBool(utils.soliditySha3("user", "investor",investor4),true);
        await this.mockStorage.setBool(utils.soliditySha3("user", "investor",investor5),true);
        await this.mockStorage.setBool(utils.soliditySha3("user", "community",community),true);

        await this.lending.saveInitialParametersToStorage(this.delayMaxDays, this.tier, this.members,community);
    });

    describe('initializing', function() {
        it('should not allow to invest before initializing', async function () {
            //await advanceBlock();
            var someLending = await ShariaHubLending.new(
                                                    this.fundingStartTime,
                                                    this.fundingEndTime,
                                                    borrower,
                                                    this.lendingInterestRatePercentage,
                                                    this.totalLendingAmount,
                                                    this.lendingDays,
                                                    this.mockStorage.address,
                                                    localNode,
                                                    ShariaHubTeam
                                                );
            await increaseTimeTo(this.fundingStartTime - duration.days(0.5))
            var isRunning = await someLending.isContribPeriodRunning();
            var state = await someLending.state();
            // project not funded
            state.toNumber().should.be.equal(Uninitialized);
            isRunning.should.be.equal(false);
            await someLending.sendTransaction({value:ether(1), from: investor}).should.be.rejectedWith(EVMRevert);
        });

        it('should not allow create projects with unregistered local nodes', async function () {
            //await advanceBlock();
            var someLending = await ShariaHubLending.new(
                                                    this.fundingStartTime,
                                                    this.fundingEndTime,
                                                    borrower,
                                                    this.lendingInterestRatePercentage,
                                                    this.totalLendingAmount,
                                                    this.lendingDays,
                                                    this.mockStorage.address,
                                                    borrower,
                                                    ShariaHubTeam
                                                ).should.be.rejectedWith(EVMRevert);

        });

        it('should not allow to invest with unregistered representatives', async function () {
            //await advanceBlock();
            var someLending = await ShariaHubLending.new(
                                                    this.fundingStartTime,
                                                    this.fundingEndTime,
                                                    localNode,
                                                    this.lendingInterestRatePercentage,
                                                    this.totalLendingAmount,
                                                    this.lendingDays,
                                                    this.mockStorage.address,
                                                    localNode,
                                                    ShariaHubTeam
                                                ).should.be.rejectedWith(EVMRevert);

        });
    });

    describe('contributing', function() {
        it('should not allow to invest before contribution period', async function () {
            await increaseTimeTo(this.fundingStartTime - duration.days(0.5))
            var isRunning = await this.lending.isContribPeriodRunning();
            isRunning.should.be.equal(false);
            await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.rejectedWith(EVMRevert);
        });

        it('should not allow to invest after contribution period', async function () {
            await increaseTimeTo(this.fundingEndTime  + duration.days(1))
            var isRunning = await this.lending.isContribPeriodRunning();
            isRunning.should.be.equal(false);
            await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.rejectedWith(EVMRevert);
        });

        it('should allow to check investor contribution amount', async function () {
            await increaseTimeTo(this.fundingStartTime + duration.days(1))
            await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
            const contributionAmount = await this.lending.checkInvestorContribution(investor);
            contributionAmount.should.be.bignumber.equal(new BigNumber(ether(1)));
        });

        it('should allow to invest in contribution period', async function () {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            var isRunning = await this.lending.isContribPeriodRunning();
            isRunning.should.be.equal(true);
            await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
        });

        it('should not allow to invest with cap fulfilled', async function () {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
            var isRunning = await this.lending.isContribPeriodRunning();
            isRunning.should.be.equal(true);
            await this.lending.sendTransaction({value:ether(1), from: investor2}).should.be.fulfilled;
            isRunning = await this.lending.isContribPeriodRunning();
            isRunning.should.be.equal(true);
            await this.lending.sendTransaction({value:ether(1), from: investor3}).should.be.fulfilled;
            isRunning = await this.lending.isContribPeriodRunning();
            isRunning.should.be.equal(false);
            await this.lending.sendTransaction({value:ether(1), from: investor4}).should.be.rejectedWith(EVMRevert);
        });

        it('should return extra value over cap to last investor', async function () {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            var initialBalance = await web3.eth.getBalance(investor2);
            await this.lending.sendTransaction({value:ether(2), from: investor}).should.be.fulfilled;
            await this.lending.sendTransaction({value:ether(1.5), from: investor2}).should.be.fulfilled;
            var afterInvestmentBalance = await web3.eth.getBalance(investor2);

        });

    });

    describe('Partial returning of funds', function() {
        it('full payment of the loan in several transfers should be allowed', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            await this.lending.sendTransaction({value: borrowerReturnAmount.div(2), from: borrower}).should.be.fulfilled;
            await this.lending.sendTransaction({value: borrowerReturnAmount.div(2), from: borrower}).should.be.fulfilled;
            const state = await this.lending.state();
            state.should.be.bignumber.equal(ContributionReturned);
        })

        it('partial payment of the loan should be still default', async function() {
            await increaseTimeTo(this.fundingEndTime - duration.minutes(1));

            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;

            //This should be the edge case : end of funding time + awaiting for return period.
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(10);
            await increaseTimeTo(defaultTime);//+ duration.days(1) + duration.minutes(2));//+ duration.seconds(1))
            const trueBorrowerReturnAmount = await this.lending.borrowerReturnAmount() // actual returnAmount
            await this.lending.sendTransaction({value: trueBorrowerReturnAmount.div(2), from: borrower}).should.be.fulfilled;
            await this.lending.sendTransaction({value: trueBorrowerReturnAmount.div(5), from: borrower}).should.be.fulfilled;
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(this.delayMaxDays + 1);
            await increaseTimeTo(defaultTime);
            this.lending.declareProjectDefault({from: owner}).should.be.fulfilled;
            var state = await this.lending.state();
            state.should.be.bignumber.equal(Default);
            var calledBurn = await this.mockReputation.burnCalled();
            calledBurn.should.be.equal(true);
        })

        it('partial payment of the loan should allow to recover contributions', async function() {
            await increaseTimeTo(this.fundingEndTime - duration.minutes(1));

            const investorInitialBalance = await web3.eth.getBalance(investor);
            var investorSendAmount = this.totalLendingAmount.mul(1).div(3);
            var investor1GasGost = new utils.toBN(0);
            var tx = await this.lending.sendTransaction({value: investorSendAmount, from: investor}).should.be.fulfilled;
            investor1GasGost = accumulateTxCost(tx,investor1GasGost);

            const investorAfterSendBalance = await web3.eth.getBalance(investor);

            const investor2InitialBalance = await web3.eth.getBalance(investor2);
            var investor2SendAmount = this.totalLendingAmount.mul(2).div(3);
            var investor2GasGost = new utils.toBN(0);
            await this.lending.sendTransaction({value: investor2SendAmount, from: investor2}).should.be.fulfilled;
            const investor2AfterSendBalance = await web3.eth.getBalance(investor2);
            investor2GasGost = accumulateTxCost(tx,investor2GasGost);

            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;

            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            //This should be the edge case : end of funding time + awaiting for return period.
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(10);
            await increaseTimeTo(defaultTime);
            const trueBorrowerReturnAmount = await this.lending.borrowerReturnAmount()
            const notFullAmount = trueBorrowerReturnAmount.div(4).mul(3);//0.75
            await this.lending.sendTransaction({value: notFullAmount, from: borrower}).should.be.fulfilled;
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(this.delayMaxDays + 1);
            await increaseTimeTo(defaultTime);
            this.lending.declareProjectDefault({from: owner}).should.be.fulfilled;
            var state = await this.lending.state();
            state.should.be.bignumber.equal(Default);


            tx = await this.lending.reclaimContributionDefault(investor, {from: investor}).should.be.fulfilled;
            investor1GasGost = accumulateTxCost(tx, investor1GasGost);
            const investorFinalBalance = await web3.eth.getBalance(investor);
            var expected = investorAfterSendBalance.add(investorSendAmount.div(4).mul(3)).sub(investor1GasGost);
            checkLostinTransactions(expected,investorFinalBalance);

            tx = await this.lending.reclaimContributionDefault(investor2, {from: investor2}).should.be.fulfilled;
            investor2GasGost = accumulateTxCost(tx, investor2GasGost);
            const investor2FinalBalance = await web3.eth.getBalance(investor2);
            var expected2 = investor2AfterSendBalance.add(investor2SendAmount.div(4).mul(3)).sub(investor2GasGost);
            checkLostinTransactions(expected2,investor2FinalBalance);

            var calledBurn = await this.mockReputation.burnCalled();
            calledBurn.should.be.equal(true);
            var contractBalance = await web3.eth.getBalance(this.lending.address);
            contractBalance.should.be.bignumber.equal(0);

        })

        it('partial payment of the loan should not allow to recover interest, local node and team fees', async function() {
            await increaseTimeTo(this.fundingEndTime - duration.minutes(1));

            var investorSendAmount = this.totalLendingAmount.mul(1).div(3);
            var tx = await this.lending.sendTransaction({value: investorSendAmount, from: investor}).should.be.fulfilled;

            var investor2SendAmount = this.totalLendingAmount.mul(2).div(3);
            await this.lending.sendTransaction({value: investor2SendAmount, from: investor2}).should.be.fulfilled;

            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;

            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            //This should be the edge case : end of funding time + awaiting for return period.
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(10);
            await increaseTimeTo(defaultTime);
            const trueBorrowerReturnAmount = await this.lending.borrowerReturnAmount()
            const notFullAmount = trueBorrowerReturnAmount.div(4).mul(3);//0.75
            await this.lending.sendTransaction({value: notFullAmount, from: borrower}).should.be.fulfilled;
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(this.delayMaxDays + 1);
            await increaseTimeTo(defaultTime);
            this.lending.declareProjectDefault({from: owner}).should.be.fulfilled;
            var state = await this.lending.state();
            state.should.be.bignumber.equal(Default);
            // Reclaims amounts
            await this.lending.reclaimContributionWithInterest(investor, {from: investor}).should.be.rejectedWith(EVMRevert);

            await this.lending.reclaimContributionWithInterest(investor2, {from: investor2}).should.be.rejectedWith(EVMRevert);
            await this.lending.reclaimLocalNodeFee().should.be.rejectedWith(EVMRevert);
            await this.lending.reclaimShariaHubTeamFee().should.be.rejectedWith(EVMRevert);
        });

    });


    describe('Retrieving contributions', function() {
      it('should allow to retrieve contributions after declaring project not funded', async function () {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
          var balance = await web3.eth.getBalance(this.lending.address);
          balance.toNumber().should.be.equal(ether(1).toNumber());
          await increaseTimeTo(this.fundingEndTime  + duration.days(1))
          await this.lending.declareProjectNotFunded({from: owner})
          var state = await this.lending.state();
          // project not funded
          state.toNumber().should.be.equal(ProjectNotFunded);
          var balance = web3.eth.getBalance(this.lending.address);
          balance.toNumber().should.be.equal(ether(1).toNumber());
          // can reclaim contribution from everyone
          balance = web3.eth.getBalance(investor);
          await this.lending.reclaimContribution(investor).should.be.fulfilled;
          // 0.1 eth less due to used gas
          new BigNumber(await web3.eth.getBalance(investor)).should.be.bignumber.above(new BigNumber(balance).add(ether(0.9).toNumber()));
          // fail to reclaim from no investor
          await this.lending.reclaimContribution(investor2).should.be.rejectedWith(EVMRevert);
      });

      it('should not allow to retrieve contributions if not contributor paid', async function () {
        await increaseTimeTo(this.fundingStartTime  + duration.days(1))
        await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
        var balance = await web3.eth.getBalance(this.lending.address);
        balance.toNumber().should.be.equal(ether(1).toNumber());
        await increaseTimeTo(this.fundingEndTime  + duration.days(1))
        await this.lending.declareProjectNotFunded({from: owner})
        var state = await this.lending.state();
        // project not funded
        state.toNumber().should.be.equal(ProjectNotFunded);
        await this.lending.reclaimContribution(investor3).should.be.rejectedWith(EVMRevert);

      });

      it('should not allow to retrieve contributions before declaring project not funded', async function () {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
          var balance = await web3.eth.getBalance(this.lending.address);
          balance.toNumber().should.be.equal(ether(1).toNumber());
          await increaseTimeTo(this.fundingEndTime  + duration.days(1))
          // can reclaim contribution from everyone
          balance = web3.eth.getBalance(investor);
          await this.lending.reclaimContribution(investor).should.be.rejectedWith(EVMRevert);

      });

      it('should not allow to retrieve contributions without interest after project is paid', async function () {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1));
          const investment2 = this.totalLendingAmount;
          const investor2InitialBalance = await web3.eth.getBalance(investor2);
          await this.lending.sendTransaction({value: investment2, from: investor2}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from: owner}).should.be.fulfilled;
          await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
          await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
          const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
          await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;
          await this.lending.reclaimContribution(investor2).should.be.rejectedWith(EVMRevert);
      });

    })


    describe('Exchange period', function() {

      it('should not go to exchange state after cap reached', async function() {
        await increaseTimeTo(this.fundingStartTime  + duration.days(1))
        await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;

        var capReached = await this.lending.capReached();
        capReached.should.be.equal(true);
        var state = await this.lending.state();
        state.toNumber().should.be.equal(AcceptingContributions);

      });

      it('should go exchange state after sending to borrower', async function() {
        await increaseTimeTo(this.fundingStartTime  + duration.days(1))
        await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
        await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
        var capReached = await this.lending.capReached();
        capReached.should.be.equal(true);
        var state = await this.lending.state();
        state.toNumber().should.be.equal(ExchangingToFiat);

      });

      it('should transfer to borrower after cap reached and method called', async function() {
        var initialBorrowerBalance = await web3.eth.getBalance(borrower);
        await increaseTimeTo(this.fundingStartTime  + duration.days(1))
        await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
        await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
        var balance = await web3.eth.getBalance(this.lending.address);
        balance.should.be.bignumber.equal(new BigNumber(0));
        var finalBorrowerBalance = await web3.eth.getBalance(borrower);
        var balance = finalBorrowerBalance.sub(initialBorrowerBalance);
        balance.should.be.bignumber.equal(this.totalLendingAmount);
      });

      it('should not transfer when cap not reached', async function() {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:this.totalLendingAmount.sub(1), from: investor}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:owner}).should.be.rejectedWith(EVMRevert);
      });
      it('should not transfer when state different than AcceptingContributions', async function() {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:owner}).should.be.rejectedWith(EVMRevert);
      });

      it('should not transfer when state different than AcceptingContributions', async function() {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:investor}).should.be.rejectedWith(EVMRevert);
      });

      it('should fail to change state to AwaitingReturn before exchanged', async function() {
        await increaseTimeTo(this.fundingStartTime  + duration.days(1))
        await this.lending.sendTransaction({value:ether(1), from: investor}).should.be.fulfilled;
        await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.rejectedWith(EVMRevert);;
      });

      it('should calculate correct fiat amount after exchange', async function() {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
          await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
          var contractinitialEthPerFiatRate = await this.lending.initialEthPerFiatRate();
          contractinitialEthPerFiatRate.toNumber().should.be.equal(this.initialEthPerFiatRate);

          const lendingFiatAmount = new BigNumber(this.initialEthPerFiatRate).mul(this.totalLendingAmount);
          const contractTotalLendingFiatAmount = await this.lending.totalLendingFiatAmount();
          contractTotalLendingFiatAmount.should.be.bignumber.equal(lendingFiatAmount);
          const contractBorrowerReturnFiatAmount = await this.lending.borrowerReturnFiatAmount();
          const interest = parseInt((this.lendingInterestRatePercentage * 100) * (this.lendingDays) / (365)) + this.ShariahubFee * 100 + this.localNodeFee * 100 ;
          const borrowerReturnFiatAmount = lendingFiatAmount.mul(interest + 10000).div(10000) ;
          contractBorrowerReturnFiatAmount.should.be.bignumber.equal(borrowerReturnFiatAmount);

      });

      it('should advance state after setting inital fiat amount', async function() {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
          await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
          const state = await this.lending.state();
          state.toNumber().should.be.equal(AwaitingReturn);

      });

      it('should not allow setting to unauthorized investors', async function() {
          await increaseTimeTo(this.fundingStartTime  + duration.days(1))
          await this.lending.sendTransaction({value:this.totalLendingAmount, from: investor}).should.be.fulfilled;
          await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
          await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: investor3}).should.be.rejectedWith(EVMRevert);


      });
    });

    describe('Borrower return', function() {

        it('should set correct parameters', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            var state = await this.lending.state();
            state.toNumber().should.be.equal(AwaitingReturn);
            const borrowerReturnEthPerFiatRate = await this.lending.borrowerReturnEthPerFiatRate();
            borrowerReturnEthPerFiatRate.should.be.bignumber.equal(new BigNumber(this.finalEthPerFiatRate));
            const lendingFiatAmount = new BigNumber(this.initialEthPerFiatRate).mul(this.totalLendingAmount);
            const interest = parseInt((this.lendingInterestRatePercentage * 100) * (this.lendingDays) / (365)) + this.ShariahubFee * 100 + this.localNodeFee * 100 ;
            const borrowerReturnFiatAmount = lendingFiatAmount.mul(interest + 10000).div(10000);
            const borrowerReturnAmount = borrowerReturnFiatAmount.div(this.finalEthPerFiatRate);
            const contractBorrowerReturnAmount = await this.lending.borrowerReturnAmount();
            contractBorrowerReturnAmount.should.be.bignumber.equal(borrowerReturnAmount);

        });

        it('should calculate correct return fiat amount based on return time', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            var state = await this.lending.state();
            state.toNumber().should.be.equal(AwaitingReturn);
            const borrowerReturnEthPerFiatRate = await this.lending.borrowerReturnEthPerFiatRate();
            borrowerReturnEthPerFiatRate.should.be.bignumber.equal(new BigNumber(this.finalEthPerFiatRate));
            const lendingFiatAmount = new BigNumber(this.initialEthPerFiatRate).mul(this.totalLendingAmount);

            var interest = parseInt((this.lendingInterestRatePercentage * 100) * (this.lendingDays) / (365)) + this.ShariahubFee * 100 + this.localNodeFee * 100 ;
            var borrowerReturnFiatAmount = lendingFiatAmount.mul(interest + 10000).div(10000);
            var borrowerReturnAmount = borrowerReturnFiatAmount.div(this.finalEthPerFiatRate);
            var contractBorrowerReturnAmount = await this.lending.borrowerReturnAmount();
            contractBorrowerReturnAmount.should.be.bignumber.equal(borrowerReturnAmount);

            var defaultTime = this.lending.fundingEndTime() + duration.days(this.lendingDays) + duration.days(90);

            await increaseTimeTo(defaultTime);

            await web3.eth.sendTransaction({to: owner, value: 1, from: owner});

            interest = parseInt((this.lendingInterestRatePercentage * 100) * (this.lendingDays) / (365)) + this.ShariahubFee * 100 + this.localNodeFee * 100 ;
            borrowerReturnFiatAmount = lendingFiatAmount.mul(interest + 10000).div(10000);
            borrowerReturnAmount = borrowerReturnFiatAmount.div(this.finalEthPerFiatRate);
            contractBorrowerReturnAmount = await this.lending.borrowerReturnAmount();
            contractBorrowerReturnAmount.should.be.bignumber.equal(borrowerReturnAmount);
        });


        it('should not allow to stablish return in other state', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.rejectedWith(EVMRevert);
        });

        //We can't track borrower because of exchange
        // it('should not allow to return contribution before setting exchange rate', async function() {
        //     await increaseTimeTo(this.fundingStartTime  + duration.days(1))
        //     await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
        //     await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
        //     await this.lending.sendTransaction({from: owner, value: ether(2)}).should.be.rejectedWith(EVMRevert);
        // });

        it('should allow the return of proper amount', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;

        });

        it('should set call increase reputation', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;
            var calledIncrease = await this.mockReputation.incrementCalled();
            calledIncrease.should.be.equal(true);
        });

        it('should decrease reputation in default', async function() {
            await increaseTimeTo(this.fundingEndTime - duration.minutes(1));

            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();

            //This should be the edge case : end of funding time + awaiting for return period.
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) + duration.days(10);
            await increaseTimeTo(defaultTime);//+ duration.days(1) + duration.minutes(2));//+ duration.seconds(1))
            //await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.rejectedWith(EVMRevert);
            const trueBorrowerReturnAmount = await this.lending.borrowerReturnAmount() // actual returnAmount
            await this.lending.sendTransaction({value: trueBorrowerReturnAmount, from: borrower}).should.be.fulfilled;

            var calledBurn = await this.mockReputation.burnCalled();
            calledBurn.should.be.equal(true);
            var delayDays = await this.mockStorage.getUint(utils.soliditySha3("lending.delayDays", this.lending.address));
            delayDays.toNumber().should.be.equal(10);


        });


    });

    describe('Default', async function() {
        it('should calculate correct time difference', async function() {
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays);
            for (var delayDays = 0; delayDays <= 10; delayDays++) {
                var resultDays = await this.lending.getDelayDays(defaultTime + duration.days(delayDays));
                resultDays.toNumber().should.be.equal(delayDays);
            }
        });

        it('should count half a day as full day', async function() {
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays);
            var resultDays = await this.lending.getDelayDays(defaultTime + duration.days(1.5));
            resultDays.toNumber().should.be.equal(1);
        });

        it('should be 0 days if not yet ended', async function() {
            var defaultTime = this.fundingEndTime + duration.days(this.lendingDays) - duration.seconds(1);
            var resultDays = await this.lending.getDelayDays(defaultTime);
            resultDays.toNumber().should.be.equal(0);
        });

        it('should allow declare project as default if no money returned after maxDelayDays', async function() {
            await increaseTimeTo(this.fundingEndTime  - duration.minutes(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const endTime = await this.lending.fundingEndTime()
            const defaultTime = endTime.add(duration.days(this.lendingDays)).add(duration.days(this.delayMaxDays));
            increaseTimeTo(defaultTime);
            // send invalid transaction to advance time
            await this.lending.sendTransaction({value: 1, from: borrower}).should.be.rejectedWith(EVMRevert);
            var tx = await this.lending.declareProjectDefault().should.be.fulfilled;
            var calledBurn = await this.mockReputation.burnCalled();
            calledBurn.should.be.equal(true);
            var delayDays = await this.mockStorage.getUint(utils.soliditySha3("lending.delayDays", this.lending.address));
            delayDays.toNumber().should.be.equal(this.delayMaxDays);
            var state = await this.lending.state();
            state.toNumber().should.be.equal(Default);
        });

        it('should not allow to declare project as default before lending period ends', async function() {
            await increaseTimeTo(this.fundingEndTime  - duration.minutes(1))
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await increaseTimeTo(this.fundingEndTime  + duration.days(this.lendingDays) + duration.days(this.delayMaxDays) - duration.days(1));
            await this.lending.declareProjectDefault().should.be.rejectedWith(EVMRevert);
        });
    });

    describe('Retrieve contribution with interest', async function() {

        it('Should return investors contributions with interests', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));

            const investment2 = ether(1);
            const investment3 = ether(0.5);
            const investment4 = ether(1.5);

            const investor2InitialBalance = await web3.eth.getBalance(investor2);
            const investor3InitialBalance = await web3.eth.getBalance(investor3);
            const investor4InitialBalance = await web3.eth.getBalance(investor4);

            await this.lending.sendTransaction({value: investment2, from: investor2}).should.be.fulfilled;
            await this.lending.sendTransaction({value: investment3, from: investor3}).should.be.fulfilled;
            await this.lending.sendTransaction({value: investment4, from: investor4}).should.be.fulfilled;
            const investor2SendTransactionBalance = await web3.eth.getBalance(investor2);
            const investor3SendTransactionBalance = await web3.eth.getBalance(investor3);
            const investor4SendTransactionBalance = await web3.eth.getBalance(investor4);
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            //console.log("borrowerReturnAmount: " + utils.fromWei(utils.toBN(borrowerReturnAmount)));
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;
            await this.lending.reclaimContributionWithInterest(investor2, {from: investor2});
            await this.lending.reclaimContributionWithInterest(investor3, {from: investor3});
            await this.lending.reclaimContributionWithInterest(investor4, {from: investor4});

            await this.lending.reclaimLocalNodeFee().should.be.fulfilled;
            await this.lending.reclaimShariaHubTeamFee().should.be.fulfilled;

            const balance = await web3.eth.getBalance(this.lending.address);
            balance.toNumber().should.be.below(2);

            const investor2FinalBalance = await web3.eth.getBalance(investor2);
            const expectedInvestor2Balance = getExpectedInvestorBalance(investor2InitialBalance, investment2, this);
            //console.log("---> Investor 2");
            //checkInvestmentResults(investor2InitialBalance,investor2SendTransactionBalance,expectedInvestor2Balance,investor2FinalBalance);
            checkLostinTransactions(expectedInvestor2Balance,investor2FinalBalance);

            const investor3FinalBalance = await web3.eth.getBalance(investor3);
            const expectedInvestor3Balance = getExpectedInvestorBalance(investor3InitialBalance, investment3, this);
            //console.log("---> Investor 3");
            //checkInvestmentResults(investor3InitialBalance,investor3SendTransactionBalance,expectedInvestor3Balance,investor3FinalBalance);
            checkLostinTransactions(expectedInvestor3Balance,investor3FinalBalance);

            const investor4FinalBalance = await web3.eth.getBalance(investor4);
            const expectedInvestor4Balance = getExpectedInvestorBalance(investor4InitialBalance, investment4, this);
            //console.log("---> Investor 4");
            //checkInvestmentResults(investor4InitialBalance,investor4SendTransactionBalance,expectedInvestor4Balance,investor4FinalBalance);
            checkLostinTransactions(expectedInvestor4Balance,investor4FinalBalance);

        });

        it('Should not allow reclaim twice the funds', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));

            const investment2 = ether(1);
            const investment3 = ether(2);

            const investor2InitialBalance = await web3.eth.getBalance(investor2);
            const investor3InitialBalance = await web3.eth.getBalance(investor3);

            await this.lending.sendTransaction({value: investment2, from: investor2}).should.be.fulfilled;
            await this.lending.sendTransaction({value: investment3, from: investor3}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;
            await this.lending.reclaimContributionWithInterest(investor2, {from: investor2}).should.be.fulfilled;
            await this.lending.reclaimContributionWithInterest(investor2, {from: investor2}).should.be.rejectedWith(EVMRevert);
        });

        it('Should not allow returns when contract have balance in other state', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));
            const investment2 = ether(1);
            await this.lending.sendTransaction({value: investment2, from: investor2}).should.be.fulfilled;
            await this.lending.reclaimContributionWithInterest(investor2).should.be.rejectedWith(EVMRevert);
        });

        it('Should return correct platform fees', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));

            const investment2 = ether(1);
            const investment3 = ether(0.5);
            const investment4 = ether(1.5);

            const investor2InitialBalance = await web3.eth.getBalance(investor2);
            const investor3InitialBalance = await web3.eth.getBalance(investor3);
            const investor4InitialBalance = await web3.eth.getBalance(investor4);
            const localNodeInitialBalance = await web3.eth.getBalance(localNode);
            const teamInitialBalance = await web3.eth.getBalance(ShariaHubTeam);

            await this.lending.sendTransaction({value: investment2, from: investor2}).should.be.fulfilled;
            await this.lending.sendTransaction({value: investment3, from: investor3}).should.be.fulfilled;
            await this.lending.sendTransaction({value: investment4, from: investor4}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            const investor2SendTransactionBalance = await web3.eth.getBalance(investor2);
            const investor3SendTransactionBalance = await web3.eth.getBalance(investor3);
            const investor4SendTransactionBalance = await web3.eth.getBalance(investor4);

            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            //console.log("borrowerReturnAmount: " + utils.fromWei(utils.toBN(borrowerReturnAmount)));
            await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;
            await this.lending.reclaimContributionWithInterest(investor2, {from: investor2});
            await this.lending.reclaimContributionWithInterest(investor3, {from: investor3});
            await this.lending.reclaimContributionWithInterest(investor4, {from: investor4});

            const localNodeBalance = await web3.eth.getBalance(localNode);
            const teamBalance = await web3.eth.getBalance(ShariaHubTeam);

            await this.lending.reclaimLocalNodeFee().should.be.fulfilled;
            await this.lending.reclaimShariaHubTeamFee().should.be.fulfilled;

            const localNodeFinalBalance = await web3.eth.getBalance(localNode);
            const expectedLocalNodeBalance = localNodeBalance.add(this.totalLendingAmount.mul(this.initialEthPerFiatRate).mul(this.localNodeFee).div(this.finalEthPerFiatRate).div(100)) ;
            //checkInvestmentResults(localNodeInitialBalance, 0, expectedLocalNodeBalance, localNodeFinalBalance);
            checkLostinTransactions(expectedLocalNodeBalance,localNodeFinalBalance);

            const teamFinalBalance = await web3.eth.getBalance(ShariaHubTeam);
            const expectedShariaHubTeamBalance = teamBalance.add(this.totalLendingAmount.mul(this.initialEthPerFiatRate).mul(this.ShariahubFee).div(this.finalEthPerFiatRate).div(100)) ;
            //checkInvestmentResults(teamInitialBalance, 0, expectedShariaHubTeamBalance, teamFinalBalance);
            checkLostinTransactions(expectedShariaHubTeamBalance,teamFinalBalance);
        });


    })

    describe('Send partial return', async function() {

        it('Should allow to send partial return before the rate is set', async function() {
            await increaseTimeTo(this.fundingStartTime + duration.days(1));
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.sendTransaction({value: ether(1), from: borrower}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
        })

        it('Should not allow to send more than collected return', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.sendTransaction({value: this.totalLendingAmount.add(ether(1)), from: borrower}).should.be.rejectedWith(EVMRevert);
        })

        it('Should not allow to send partial return after the rate is set', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));
            await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
            await this.lending.sendTransaction({value: ether(1), from: borrower}).should.be.rejectedWith(EVMRevert);
        })

        // We can't restrict returns
        // it('Should only allow borrower to send partial return', async function() {
        //     await increaseTimeTo(this.fundingStartTime  + duration.days(1));
        //     await this.lending.sendTransaction({value: this.totalLendingAmount, from: investor}).should.be.fulfilled;
        //     await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;
        //     await this.lending.sendTransaction({value: ether(1), from: investor2}).should.be.rejectedWith(EVMRevert);
        //     await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;
        // })

        it('Should allow to reclaim partial return from contributor', async function() {
            await increaseTimeTo(this.fundingStartTime  + duration.days(1));

            const investorInvestment = ether(1);
            const investor2Investment = ether(2);
            const surplus = ether(1);
            await this.lending.sendTransaction({value: investorInvestment , from: investor}).should.be.fulfilled;
            await this.lending.sendTransaction({value: investor2Investment, from: investor2}).should.be.fulfilled;
            await this.lending.sendFundsToBorrower({from:owner}).should.be.fulfilled;

            // send surplus 1 eth
            await this.lending.sendTransaction({value: surplus, from: borrower}).should.be.fulfilled
            await this.lending.finishInitialExchangingPeriod(this.initialEthPerFiatRate, {from: owner}).should.be.fulfilled;

            await this.lending.setBorrowerReturnEthPerFiatRate(this.finalEthPerFiatRate, {from: owner}).should.be.fulfilled;
            var investorInitialBalance = await web3.eth.getBalance(investor);
            var investor2InitialBalance = await web3.eth.getBalance(investor2);
            await this.lending.reclaimSurplusEth(investor).should.be.fulfilled;
            await this.lending.reclaimSurplusEth(investor2).should.be.fulfilled;


            var investorFinalBalance = await web3.eth.getBalance(investor);
            var expectedInvestorBalance = investorInitialBalance.add(ether(1).div(3));
            checkLostinTransactions(expectedInvestorBalance,investorFinalBalance);

            var investor2FinalBalance = await web3.eth.getBalance(investor2);
            var expectedInvestor2Balance = investor2InitialBalance.add(ether(2).div(3));
            checkLostinTransactions(expectedInvestor2Balance,investor2FinalBalance);


            const borrowerReturnAmount = await this.lending.borrowerReturnAmount();
            //console.log("borrowerReturnAmount: " + utils.fromWei(utils.toBN(borrowerReturnAmount)));
            await this.lending.sendTransaction({value: borrowerReturnAmount, from: borrower}).should.be.fulfilled;

            var investorInitialBalance = await web3.eth.getBalance(investor);
            var investor2InitialBalance = await web3.eth.getBalance(investor2);
            await this.lending.reclaimContributionWithInterest(investor).should.be.fulfilled;
            await this.lending.reclaimContributionWithInterest(investor2).should.be.fulfilled;


            var investorFinalBalance = await web3.eth.getBalance(investor);
            var expectedInvestorBalance = getExpectedInvestorBalance(investorInitialBalance, investorInvestment.sub(ether(1).div(3)), this)
            checkLostinTransactions(expectedInvestorBalance,investorFinalBalance);

            var investor2FinalBalance = await web3.eth.getBalance(investor2);
            var expectedInvestor2Balance = getExpectedInvestorBalance(investorInitialBalance, investor2Investment.sub(ether(2).div(3)), this);
            checkLostinTransactions(expectedInvestor2Balance,investor2FinalBalance);

        })



    })

    function getExpectedInvestorBalance(initialAmount,contribution,testEnv) {

        const received = contribution.mul(testEnv.initialEthPerFiatRate)
                            .mul(testEnv.lendingInterestRatePercentage)
                            .div(testEnv.finalEthPerFiatRate).div(10000);
        return initialAmount.sub(contribution).add(received);

    }

    function accumulateTxCost(tx, cost) {

        return cost.add(utils.toBN(tx.receipt.gasUsed).mul(utils.toBN(web3.eth.gasPrice)));
    }

    function checkInvestmentResults(investorInitialBalance, sendTransactionBalance, expected, actual) {
        console.log("Initial balance:");
        console.log(utils.fromWei(utils.toBN(investorInitialBalance), 'ether'));
        console.log("Send tx balance:");
        console.log(utils.fromWei(utils.toBN(sendTransactionBalance), 'ether'));
        console.log("Final balance:");
        console.log(utils.fromWei(utils.toBN(actual), 'ether'));
        console.log("Expected balance:");
        console.log(utils.fromWei(utils.toBN(expected), 'ether'));
    }

    function checkLostinTransactions(expected, actual) {
        const lost = expected.sub(actual);
        //console.log("Perdida:" + utils.fromWei(utils.toBN(Math.floor(lost.toNumber())), 'ether'));
        // /* Should be below 0.02 eth */
        lost.should.be.bignumber.below('20000000000000000');
    }

})
