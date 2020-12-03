var expect = require("chai").expect;
const algosdk = require('algosdk')
const asaTools = require('../asa-tools')
const vault = require('../vault')
const accountTest = require('./account-test')
const config = require('../config')
const fs = require('fs')
const mochaTools = require('./mocha-tools');

let settings
let burnFee = 150
let mintFee = 200
let creationFee = 550000
let fakeAssetId
let fakeAppId

let signatures = {}
let addresses
let algodClient
let mintAddr
let clearStateAttackAddr
let error

const testApprovalProgramFilename = 'true-program.teal'
const testClearStateProgramFilename = 'true-program.teal'

function setupClient() {
	algodClient = settings.algodClient
	signatures = settings.signatures
	addresses = settings.addresses
	mintAddr = settings.minterAddress
	dispenserAddr = settings.dispenserAddress
	clearStateAttackAddr = settings.clearStateAttackAddr

	vaultManager = new vault.VaultManager(algodClient, settings.appId, addresses[0], settings.assetId)
	if(settings.burnFee !== undefined) {
		burnFee = settings.burnFee
	}
	if(settings.mintFee !== undefined) {
		mintFee = settings.mintFee
	}
	if(settings.creationFee !== undefined) {
		creationFee = settings.creationFee
	}
	if(settings.fakeAssetId) {
		fakeAssetId = settings.fakeAssetId
	}
	if(settings.fakeAppId) {
		fakeAppId = settings.fakeAppId
	}
}


function signCallback(sender, tx) {
	const txSigned = tx.signTxn(signatures[sender].sk)
	return txSigned
}

function lsigCallback(sender, lsig) {
	lsig.sign(signatures[sender].sk)
}

settings = config.initialize()
setupClient()

async function testAccount(accountAddr, depositAmount, mintAmount, withdrawAmount, burnAmount) {
	let txId
	let vaultBalance
	let withdrawalAmount
	let minted
	let txResponse
	let burnFee
	let maxMintAmount
	let mintFee
	let restoreAmount

	let adminAddr = addresses[0]

	it("Dispense Account: Verify it has enough algos for the tests", async function() {

		let balance = await vaultManager.accountBalance(accountAddr)
		if(balance < depositAmount*2) {
			txId = await vaultManager.transferAlgos(dispenserAddr, accountAddr, depositAmount*2, undefined, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
		}
		balance = await vaultManager.accountBalance(accountAddr)
		expect(balance).to.be.at.least(depositAmount*2)
	})

	it("updateApp: User account", async function() {
		try {
			txId = await vaultManager.updateApp(accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("deleteApp: User account", async function() {
		try {
			txId = await vaultManager.deleteApp(accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("setGlobalStatus(0): User account", async function() {
		try {
			txId = await vaultManager.setGlobalStatus(accountAddr, 0, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("setAccountStatus(0): User account", async function() {
		try {
			txId = await vaultManager.setAccountStatus(accountAddr, accountAddr, 0, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("setMintAccount: User account", async function() {
		try {
			txId = await vaultManager.setMintAccount(accountAddr, accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("setAdminAccount: User account", async function() {
		try {
			txId = await vaultManager.setAdminAccount(accountAddr, accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("setMintFee: User account", async function() {
		let error
		try {
			txId = await vaultManager.setMintFee(accountAddr, 300, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})

	it("setBurnFee: User account", async function() {
		try {
			txId = await vaultManager.setBurnFee(accountAddr, 300, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)
	})
	it("setCreationFee: User account", async function() {
		try {
			txId = await vaultManager.setCreationFee(addresses[2], 300, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALRejectNonAdminError(error)		
	})
	it("Restore Account: Burn, withdraw and closeOut Vault to restore original state", async function() {
		mintFee = await vaultManager.mintFee()
		burnFee = await vaultManager.burnFee()
		minted = await vaultManager.minted(accountAddr)
		vaultBalance = await vaultManager.vaultBalance(accountAddr)
		if(vaultBalance > vaultManager.minVaultBalance() || minted > 0) {
			withdrawalAmount = vaultBalance - vaultManager.minVaultBalance() - vaultManager.minTransactionFee()
			// just in case it did not opt In
			let vaultAddr = await vaultManager.vaultAddressByApp(accountAddr)
			if(!vaultAddr) {
				vaultAddr = await vaultManager.vaultAddressByTEAL(accountAddr)
				expect(vaultAddr).to.equal(vaultAddr)
				return
			}
			else {
				txId = await vaultManager.setAccountStatus(addresses[0], accountAddr, 1, signCallback)
				await vaultManager.waitForTransactionResponse(txId)

				if(minted) {
					// just in case it does not have enough balance to pay fees
					txId = await vaultManager.depositALGOs(accountAddr, Math.ceil(minted*burnFee/10000) + vaultManager.minTransactionFee(), signCallback)
					await vaultManager.waitForTransactionResponse(txId)

					console.log('burnwALGOs')
					txId = await vaultManager.burnwALGOs(accountAddr, Math.floor(minted), signCallback)
					await vaultManager.waitForTransactionResponse(txId)
				}
			}

			withdrawalAmount = await vaultManager.maxWithdrawAmount(accountAddr)

			if(withdrawalAmount > 0) {
				txId = await vaultManager.withdrawALGOs(accountAddr, withdrawalAmount, signCallback)
			}
			await vaultManager.waitForTransactionResponse(txId)
		}

		// when the Vault TEAL is changed both addresses do not match and the CloseOut fails
		let vaultAddrApp = await vaultManager.vaultAddressByApp(accountAddr)
		let vaultAddrTEAL = await vaultManager.vaultAddressByTEAL(accountAddr)
		if(vaultAddrApp == vaultAddrTEAL) {
			txId = await vaultManager.closeOut(accountAddr, signCallback)
		}
		else if(vaultAddrApp) {
			// Vault TEAL changed: can not make a ClouseOut so call clearApp
			txId = await vaultManager.clearApp(accountAddr, signCallback)
		}
		// if the code reaches here it is a success
		expect(1).to.equal(1)
	})
	it("Restore Account: Remove Fake wALGOs from account", async function() {
		let asaBalance = await vaultManager.assetBalance(accountAddr, fakeAssetId)
		if(asaBalance !== 0) {
			txId = await vaultManager.transferAsset(accountAddr, mintAddr, 0, mintAddr, signCallback, fakeAssetId)
			mochaTools.expectTxId(txId)
		}
		else {
			expect(asaBalance).to.equal(0)
		}
	})
	it("optIn: Try optIn paying less fees", async function() {
		try {
			txId = await vaultManager.optIn(accountAddr, signCallback, creationFee-1)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})


	it("optIn: Try optIn paying fees to an incorrect account", async function() {
		try {
			txId = await vaultManager.optIn(accountAddr, signCallback, undefined, addresses[1])
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("optIn account", async function() {
		txId = await vaultManager.optIn(accountAddr, signCallback)
		mochaTools.expectTxId(txId)
	})
	it("optInASA account", async function() {
		txId = await vaultManager.optInASA(accountAddr, signCallback)
		mochaTools.expectTxId(txId)
	})
	it("optInASA Fake", async function() {
		txId = await vaultManager.optInASA(accountAddr, signCallback, fakeAssetId)
		mochaTools.expectTxId(txId)
	})
	it("Transfer Fake asset to try to cheat", async function() {
		txId = await vaultManager.transferAsset(mintAddr, accountAddr, mintAmount, undefined, signCallback, fakeAssetId)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})

	// test all admin functions with User account after optIn
	it("updateApp: User account after optIn", async function() {
		try {
			txId = await vaultManager.updateApp(accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("deleteApp: User account after optIn", async function() {
		try {
			txId = await vaultManager.deleteApp(accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setGlobalStatus(0): User account after optIn", async function() {
		try {
			txId = await vaultManager.setGlobalStatus(accountAddr, 0, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setAccountStatus(0): User account after optIn", async function() {
		try {
			txId = await vaultManager.setAccountStatus(accountAddr, accountAddr, 0, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setMintAccount: User account after optIn", async function() {
		try {
			txId = await vaultManager.setMintAccount(accountAddr, accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setAdminAccount: User account after optIn", async function() {
		try {
			txId = await vaultManager.setAdminAccount(accountAddr, accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setMintFee: User account after optIn", async function() {
		let error
		try {
			txId = await vaultManager.setMintFee(accountAddr, 300, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})

	it("setBurnFee: User account after optIn", async function() {
		try {
			txId = await vaultManager.setBurnFee(accountAddr, 300, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setCreationFee: User account after optIn", async function() {
		try {
			txId = await vaultManager.setCreationFee(accountAddr, 300, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	// Audit attack. Deposit 2000 malgos, mint 2000 microwalgos and burn 1 microwalgo paying the fee from the vault. Ends with 1999 microwalgos minted
	// and the Vault with 1000 microalgos balance
	it("TOB Audit: Lack of fee consideration for burning operation lead the system to be undercollateralized", async function() {
		txId = await vaultManager.depositALGOs(accountAddr, 202000, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("TOB Audit: mintwALGOs max amount", async function() {
		maxMintAmount = await vaultManager.maxMintAmount(accountAddr)
		txId = await vaultManager.mintwALGOs(accountAddr, maxMintAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("TOB Audit: burnwALGOs Burn Fee attack: burn operation does not take into account fees paid from Vault", async function() {
		try {
			txId = await vaultManager.burnwALGOs(accountAddr, 1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("TOB Audit: Rollback", async function() {
		txId = await vaultManager.burnwALGOs(accountAddr, maxMintAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("setGlobalStatus == 0", async function() {
		txId = await vaultManager.setGlobalStatus(adminAddr, 0, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	// depositALGOs cannot be avoided because it is just a direct deposit
	it("depositALGOs", async function() {
		txId = await vaultManager.depositALGOs(accountAddr, depositAmount, signCallback)
		mochaTools.expectTxId(txId)
	})
	it("withdrawALGOs: verify that the account does not work if the GS == 0", async function() {
		try {
			txId = await vaultManager.withdrawALGOs(accountAddr, withdrawAmount, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setGlobalStatus(2): try incorrect input", async function() {
		try {
			txId = await vaultManager.setGlobalStatus(adminAddr, 2, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setGlobalStatus(10): try incorrect input", async function() {
		try {
			txId = await vaultManager.setGlobalStatus(adminAddr, 10, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setGlobalStatus(1)", async function() {
		txId = await vaultManager.setGlobalStatus(adminAddr, 1, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})

	it("setAccountStatus(10): try incorrect input", async function() {
		try {
			txId = await vaultManager.setAccountStatus(adminAddr, accountAddr, 10, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setAccountStatus(0): disable account", async function() {
		txId = await vaultManager.setAccountStatus(adminAddr, accountAddr, 0, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("setAccountStatus(0): try withdrawALGOs", async function() {
		try {
			txId = await vaultManager.withdrawALGOs(accountAddr, withdrawAmount, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("setAccountStatus(1): enable account", async function() {
		txId = await vaultManager.setAccountStatus(adminAddr, accountAddr, 1, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("TOB Audit: clearStateAttack, transfer algos", async function() {
		txId = await vaultManager.transferAlgos(adminAddr, clearStateAttackAddr, creationFee + 100000, undefined, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	// try to send 2 txs in a group to drain algos from a Vault creating a clearState from the sender and
	// withdrawing algos from a Vault that the sender does not own.
	it("TOB Audit: Lack of clear state program check allows any vault to be drained: optIn clearStateAttackAddr", async function() {
		txId = await vaultManager.optIn(clearStateAttackAddr, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("TOB Audit: clearStateAttack", async function() {
		try {
			txId = await vaultManager.clearStateAttack(clearStateAttackAddr, accountAddr, 100000, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("TOB Audit: closeOut clearStateAttackAddr", async function() {
		txId = await vaultManager.closeOut(clearStateAttackAddr, signCallback)
		mochaTools.expectTxId(txId)
	})

	it("Mint attack from Admin: try to send 2 txs in a group to withdraw algos from a Vault using admin account", async function() {
		try {
			txId = await vaultManager.setMintAccountAttack(adminAddr, mintAddr, accountAddr, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("TOB Audit: Anyone can update or delete the app-vault: updateAppAttack: try to update the app doing an user op with the correct arguments", async function() {
		try {
			txId = await vaultManager.updateAppAttack(accountAddr, 10000, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("Mint attack: try to mint a different ASA from Minter", async function() {
		try {
			txId = await vaultManager.mintwALGOs(accountAddr, mintAmount, signCallback, undefined, fakeAssetId)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("mintwALGOs: try to mint wALGOs paying a higher fee from the Minter account", async function() {
		try {
			txId = await vaultManager.mintwALGOs(accountAddr, mintAmount, signCallback, undefined, undefined, 2000)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("mintwALGOs " + Math.floor(mintAmount/2) + " with fee ", async function() {
		let minted = await vaultManager.minted(accountAddr)
		txId = await vaultManager.mintwALGOs(accountAddr, Math.floor(mintAmount/2), signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		minted = await vaultManager.minted(accountAddr) - minted
		expect(minted).to.equal(Math.floor(mintAmount/2))
	})
	it("setMintFee(0)", async function() {
		txId = await vaultManager.setMintFee(adminAddr, 0, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let curMintFee = await vaultManager.mintFee()
		expect(curMintFee).to.equal(0)
	})
	it("mintwALGOs with no fee", async function() {
		let minted = await vaultManager.minted(accountAddr)
		txId = await vaultManager.mintwALGOs(accountAddr, mintAmount - Math.floor(mintAmount/2), signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		minted = await vaultManager.minted(accountAddr) - minted
		expect(minted).to.equal(mintAmount - Math.floor(mintAmount/2))
	})
	it("setMintFee(mintFee): Restore mint fee", async function() {
		txId = await vaultManager.setMintFee(adminAddr, mintFee, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let curMintFee = await vaultManager.mintFee()
		expect(curMintFee).to.equal(mintFee)
	})
	it("withdrawALGOs: try to withdraw more than allowed", async function() {
		let maxWithdrawAmount = await vaultManager.maxWithdrawAmount(accountAddr)
		try {
			txId = await vaultManager.withdrawALGOs(accountAddr, maxWithdrawAmount + 1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("withdrawALGOs " + withdrawAmount, async function() {
		txId = await vaultManager.withdrawALGOs(accountAddr, withdrawAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("burnwALGOs more than minted", async function() {
		try {
			txId = await vaultManager.burnwALGOs(accountAddr, mintAmount+1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("burnwALGOs send incorrect ASA", async function() {
		try {
			txId = await vaultManager.burnwALGOs(accountAddr, Math.floor(mintAmount/4), signCallback, fakeAssetId)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("mintwALGOs try to mint a different app id ", async function() {
		maxMintAmount = await vaultManager.maxMintAmount(accountAddr)
		try {
			txId = await vaultManager.mintwALGOs(accountAddr, maxMintAmount, signCallback, fakeAppId)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("mintwALGOs more than allowed ", async function() {
		maxMintAmount = await vaultManager.maxMintAmount(accountAddr)
		try {
			txId = await vaultManager.mintwALGOs(accountAddr, maxMintAmount + 1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("mintwALGOs mint maximum allowed " + maxMintAmount, async function() {
		minted = await vaultManager.minted(accountAddr)
		txId = await vaultManager.mintwALGOs(accountAddr, maxMintAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		minted = await vaultManager.minted(accountAddr) - minted
		expect(minted).to.equal(maxMintAmount)
	})
	it("burnwALGOs rollback maxBurnAmount", async function() {
		minted = await vaultManager.minted(accountAddr)
		txId = await vaultManager.burnwALGOs(accountAddr, maxMintAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let newMinted = await vaultManager.minted(accountAddr)
		expect(minted).to.equal(newMinted + maxMintAmount)
	})
	it("TOB Audit: Minter can be abused to avoid paying the burned wAlgo", async function() {
		try {
			txId = await vaultManager.burnwALGOsAttack(accountAddr, Math.floor(burnAmount/2), signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("burnwALGOs with Fee", async function() {
		minted = await vaultManager.minted(accountAddr)
		txId = await vaultManager.burnwALGOs(accountAddr, Math.floor(burnAmount/2), signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let newMinted = await vaultManager.minted(accountAddr)
		expect(minted).to.equal(newMinted + Math.floor(burnAmount/2))
	})
	it("setBurnFee(0)", async function() {
		txId = await vaultManager.setBurnFee(adminAddr, 0, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let fee = await vaultManager.burnFee()
		expect(fee).to.equal(0)
	})
	it("burnwALGOs more than minted with no fee", async function() {
		try {
			txId = await vaultManager.burnwALGOs(accountAddr, mintAmount - Math.floor(burnAmount/2) + 1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("burnwALGOs with no Fee", async function() {
		minted = await vaultManager.minted(accountAddr)
		txId = await vaultManager.burnwALGOs(accountAddr, burnAmount - Math.floor(burnAmount/2), signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let newMinted = await vaultManager.minted(accountAddr)
		expect(minted).to.equal(newMinted + (burnAmount - Math.floor(burnAmount/2)))
	})
	it("setBurnFee(burnFee): Restore previous burn fee", async function() {
		txId = await vaultManager.setBurnFee(adminAddr, burnFee, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		let fee = await vaultManager.burnFee()
		expect(fee).to.equal(burnFee)
	})
	it("burnwALGOs try to burn more wALGOs that were minted", async function() {
		try {
			txId = await vaultManager.burnwALGOs(accountAddr, mintAmount - burnAmount + 1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("mintwALGOs verify minted amounts", async function() {
		minted = await vaultManager.minted(accountAddr)
		expect(minted).to.equal(mintAmount - burnAmount);
	})
	it("withdrawALGOs exceeding maximum ", async function() {
		restoreAmount = await vaultManager.maxWithdrawAmount(accountAddr)
		try {
			txId = await vaultManager.withdrawALGOs(accountAddr, restoreAmount + 1, signCallback)
			error = 0
		} catch(err) {
			error = err
		}
		mochaTools.expectTEALReject(error)
	})
	it("withdrawALGOs maximum amount", async function() {
		txId = await vaultManager.withdrawALGOs(accountAddr, restoreAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("burnwALGOs burn all minted Algos", async function() {
		txId = await vaultManager.burnwALGOs(accountAddr, mintAmount - burnAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		minted = await vaultManager.minted(accountAddr)
		expect(minted).to.equal(0)
	})
	it("withdrawALGOs maximum amount after burning algos", async function() {
		restoreAmount = await vaultManager.maxWithdrawAmount(accountAddr)
		txId = await vaultManager.withdrawALGOs(accountAddr, restoreAmount, signCallback)
		txResponse = await vaultManager.waitForTransactionResponse(txId)
		mochaTools.expectTxId(txId)
	})
	it("restoreAmount == 0", async function() {
		restoreAmount = await vaultManager.maxWithdrawAmount(accountAddr)
		expect(restoreAmount).to.equal(0)
	})
	it("transferAsset restore Fake asset", async function() {
		txId = await vaultManager.transferAsset(accountAddr, mintAddr, mintAmount, mintAddr, signCallback, fakeAssetId)
		mochaTools.expectTxId(txId)
	})
	it("closeOut Account", async function() {
		txId = await vaultManager.closeOut(accountAddr, signCallback)
		mochaTools.expectTxId(txId)
	})
}

describe("StakerDAO Vault Test", async function() {
	this.timeout(settings.timeout);

	describe("Creation ASA and Application", function() {
		it("Create ASA", async function() {
			if(!settings.assetId) {
				txId = await asaTools.createASA(algodClient, mintAddr, 8000000000000000, 6, 'wALGO', 'Wrapped ALGO', 'https://stakerdao', signCallback);
				txResponse = await vaultManager.waitForTransactionResponse(txId)
				settings.assetId = txResponse['asset-index']
				vaultManager.setAssetId(settings.assetId)
				console.log('Asset Id: %d', settings.assetId)
      	expect(settings.assetId).to.be.above(0)
			}
			else {
				expect(1).to.equal(1)
			}
		})

		it("Create ASA Fake", async function() {
			txId = await asaTools.createASA(algodClient, mintAddr, 8000000000000000, 6, 'wALGOF', 'Wrapped ALGO Fake', 'https://stakerdao', signCallback);
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			fakeAssetId = txResponse['asset-index']
			console.log('Fake Asset Id: %d', fakeAssetId)
			expect(settings.assetId).to.be.above(0)
		})

		it("createApp", async function() {
			if(!settings.appId) {
				txId = await vaultManager.createApp(addresses[0], signCallback)
				txResponse = await vaultManager.waitForTransactionResponse(txId)
				let appId = vaultManager.appIdFromCreateAppResponse(txResponse)
				vaultManager.setAppId(appId)
				console.log('App Id: %d', appId)
      	expect(appId).to.be.above(0)
			}
			else {
				expect(1).to.equal(1)
			}
		})
		it("createApp: Create Fake App to test", async function() {
			if(!settings.fakeAppId) {
				txId = await vaultManager.createApp(addresses[0], signCallback, testApprovalProgramFilename, testClearStateProgramFilename)
				txResponse = await vaultManager.waitForTransactionResponse(txId)		
				fakeAppId = vaultManager.appIdFromCreateAppResponse(txResponse)
				console.log('Fake App Id: %d', fakeAppId)
				expect(fakeAppId).to.be.above(0)
			}
			else {
				expect(1).to.equal(1)
			}
		})
	})

  describe("Admin Operations", async function() {
		it("updateApp: Admin", async function() {
			txId = await vaultManager.updateApp(addresses[0], signCallback)
			mochaTools.expectTxId(txId)
		})

		it("setGlobalStatus: Admin set to 1", async function() {
			txId = await vaultManager.setGlobalStatus(addresses[0], 1, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			mochaTools.expectTxId(txId)
		})
		it("setMintAccount: Admin", async function() {
			txId = await vaultManager.setMintAccount(addresses[0], addresses[1], signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let addr = await vaultManager.mintAccount()
			expect(addresses[1]).to.equal(addr)
		})
		it("setAdminAccount: Admin", async function() {
			txId = await vaultManager.setAdminAccount(addresses[0], addresses[2], signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let addr = await vaultManager.adminAccount()
			expect(addresses[2]).to.equal(addr)
		})
		it("setMintAccount: Admin", async function() {
			txId = await vaultManager.setMintAccount(addresses[2], mintAddr, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let addr = await vaultManager.mintAccount()
			expect(mintAddr).to.equal(addr)
		})
		it("setAdminAccount: Admin restore old Admin account", async function() {
			txId = await vaultManager.setAdminAccount(addresses[2], addresses[0], signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let addr = await vaultManager.adminAccount()
			expect(addresses[0]).to.equal(addr)
		})

		it("optIn: try to optIn Admin account", async function() {
			try {
				txId = await vaultManager.optIn(addresses[0], signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALReject(error)
		})


		it("setMintFee: Admin trying to set a fee above the limits 5001 more than 5000", async function() {
			try {
				txId = await vaultManager.setMintFee(addresses[0], 5001, signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALReject(error)
			
		})

		it("setBurnFee: Admin trying to set a fee above the limits 5001 more than 5000", async function() {
			try {
				txId = await vaultManager.setBurnFee(addresses[0], 5001, signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALReject(error)
			
		})

		it("setMintFee: Minter try to change fee", async function() {
			try {
				txId = await vaultManager.setMintFee(mintAddr, 10, signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALRejectNonAdminError(error)			
		})
		it("setBurnFee: Minter try to change fee", async function() {
			try {
				txId = await vaultManager.setBurnFee(mintAddr, 10, signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALRejectNonAdminError(error)			
		})
		it("setMintFee: Minter try to change fee", async function() {
			try {
				txId = await vaultManager.setMintFee(mintAddr, 10, signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALRejectNonAdminError(error)			
		})

		it("setCreationFee: Minter try to change fee", async function() {
			try {
				txId = await vaultManager.setCreationFee(mintAddr, 5001, signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALRejectNonAdminError(error)
		})

		it("setBurnFee: Reset to 0", async function() {
			txId = await vaultManager.setBurnFee(addresses[0], 0, signCallback)
			mochaTools.expectTxId(txId)
		})
		it("setMintFee: Reset to 0", async function() {
			txId = await vaultManager.setMintFee(addresses[0], 0, signCallback)
			mochaTools.expectTxId(txId)
		})
		it("setCreationFee: Reset to 0", async function() {
			txId = await vaultManager.setCreationFee(addresses[0], 0, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			mochaTools.expectTxId(txId)
		})
		it("Verify burnFee is 0", async function() {
			let fee = await vaultManager.burnFee()
			expect(fee).to.equal(0);
		})
		it("Verify mintFee is 0", async function() {
			let fee = await vaultManager.mintFee()
			expect(fee).to.equal(0);
		})
		it("Verify creationFee is 0", async function() {
			let fee = await vaultManager.creationFee()
			expect(fee).to.equal(0);
		})
		it("setBurnFee: Admin", async function() {
			txId = await vaultManager.setBurnFee(addresses[0], burnFee, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let fee = await vaultManager.burnFee()
			expect(fee).to.equal(burnFee)
		})
		it("setMintFee: Admin", async function() {
			txId = await vaultManager.setMintFee(addresses[0], mintFee, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let fee = await vaultManager.mintFee()
			expect(fee).to.equal(mintFee)
		})
		it("setCreationFee: Admin", async function() {
			txId = await vaultManager.setCreationFee(addresses[0], creationFee, signCallback)
			txResponse = await vaultManager.waitForTransactionResponse(txId)
			let fee = await vaultManager.creationFee()
			expect(fee).to.equal(creationFee)
		})
		// try to optIn an address whose Vault balance != 0. It should fail, allowing non-zero balance vaults can be attacked by
		// malicius users: ClearState a vault with minted wALGOs and then re-create it
		it("Verify that addresses which Vault balance is above 0 can not optIn", async function() {
			let vaultAddr = await vaultManager.vaultAddressByTEAL(addresses[6])
			let vaultBalance = await vaultManager.vaultBalance(addresses[6])
			let lastTxId
			const params = await algodClient.getTransactionParams().do()
			if(vaultBalance == 0) {
				params.fee = vaultManager.minFee
				params.flatFee = true

				let txPay = algosdk.makePaymentTxnWithSuggestedParams(addresses[0], vaultAddr, 110000, undefined, new Uint8Array(0), params)
				let txSigned = signCallback(addresses[0], txPay)
				let tx = await algodClient.sendRawTransaction(txSigned).do()
				lastTxId = tx.txId
			}
			let accountInfo = await algodClient.accountInformation(addresses[6]).do()
			if(accountInfo.amount < creationFee + 200000) {
				txPay = algosdk.makePaymentTxnWithSuggestedParams(addresses[0], addresses[6], creationFee + 300000, undefined, new Uint8Array(0), params)
				txSigned = signCallback(addresses[0], txPay)
				tx = await algodClient.sendRawTransaction(txSigned).do()
				lastTxId = tx.txId
			}
			if(lastTxId) {
				await vaultManager.waitForTransactionResponse(lastTxId)
			}

			try {
				txId = await vaultManager.optIn(addresses[6], signCallback)
				error = 0
			} catch(err) {
				error = err
			}
			mochaTools.expectTEALReject(error)
			
		})
	})

	describe("Preparation User Operations", async function() {
		it("Delete old delegation file", async function() {
			try {
				fs.unlinkSync(settings.minterDelegateFile)
			} catch(err) {
			}
			expect(fs.existsSync(settings.minterDelegateFile)).to.be.false;
		})

		it("generateDelegatedMint: Minter signs a delegation to mint from the App", async function() {
			await vaultManager.createDelegatedMintAccountToFile(settings.minterDelegateFile, lsigCallback)
			vaultManager.delegateMintAccountFromFile(settings.minterDelegateFile)
			expect(fs.existsSync(settings.minterDelegateFile)).to.be.true;
		})
	})

	describe("Account Operations", async function() {
		describe("Testing account " + addresses[1], async function() {
			await testAccount(addresses[1], 12000405, 4545000, 5500000, 2349000)
		})
		describe("Testing account " + addresses[2], async function() {
			await testAccount(addresses[2], 6000405, 5545000, 300000, 4349000)
		})
		describe("Testing account " + addresses[3], async function() {
			await testAccount(addresses[3], 8000405, 3545000, 4300000, 3349000)
		})
		describe("Testing account " + addresses[4], async function() {
			await testAccount(addresses[4], 9000405, 8545000, 325230, 7349000)
		})
		describe("Testing account " + addresses[5], async function() {
			await testAccount(addresses[5], 4500405, 3200405, 410000, 2500000)
		})
	})

  describe("Destruction Functions", async function() {
		it("deleteApp", async function() {
			if(!settings.appId && !settings.keepCreatedApp) {
				txId = await vaultManager.deleteApp(addresses[0], signCallback)
				mochaTools.expectTxId(txId)
			}
			else {
				expect(1).to.equal(1)
			}
		})
		it("deleteApp: Fake App", async function() {
			if(!settings.fakeAppId) {
				txId = await vaultManager.deleteApp(addresses[0], signCallback, fakeAppId)
				mochaTools.expectTxId(txId)
			}
			else {
				expect(1).to.equal(1)
			}
		})
		it("Destroy ASA", async function() {
			if(!settings.assetId && !settings.keepCreatedAsset) {
				txId = await asaTools.destroyASA(algodClient, mintAddr, settings.assetId, signCallback);
				mochaTools.expectTxId(txId)
			}
			else {
				expect(1).to.equal(1)
			}
		})
		it("destroyASA: Fake Asset", async function() {
			if(!settings.fakeAssetId) {
				txId = await asaTools.destroyASA(algodClient, mintAddr, fakeAssetId, signCallback);
				mochaTools.expectTxId(txId)
			}
			else {
				expect(1).to.equal(1)
			}
		})
	})
})