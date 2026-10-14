import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("SolarShare", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [seller, buyer, outsider] = await viem.getWalletClients();
  type TradeTuple = readonly [bigint, bigint, `0x${string}`, `0x${string}`, bigint, bigint, number];
  type OfferTuple = readonly [bigint, `0x${string}`, bigint, bigint, number];

  async function deployContract() {
    return viem.deployContract("SolarShare");
  }

  it("registers participants and completes offer, purchase, and settlement", async () => {
    const solarShare = await deployContract();
    const pricePerKWh = parseEther("0.01");

    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    const offerHash = await solarShare.write.createOffer([10n, pricePerKWh], {
      account: seller.account
    });
    await publicClient.waitForTransactionReceipt({ hash: offerHash });

    const purchaseHash = await solarShare.write.purchaseEnergy([0n, 4n], {
      account: buyer.account,
      value: pricePerKWh * 4n
    });
    await publicClient.waitForTransactionReceipt({ hash: purchaseHash });

    const pendingTrade = (await solarShare.read.trades([0n])) as TradeTuple;
    assert.equal(pendingTrade[3].toLowerCase(), buyer.account.address.toLowerCase());
    assert.equal(pendingTrade[5], pricePerKWh * 4n);

    const settleHash = await solarShare.write.settleTrade([0n], {
      account: seller.account
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
    assert.equal(receipt.status, "success");

    const settledTrade = (await solarShare.read.trades([0n])) as TradeTuple;
    assert.equal(settledTrade[6], 1);
    const remainingOffer = (await solarShare.read.offers([0n])) as OfferTuple;
    assert.equal(remainingOffer[2], 6n);
  });

  it("rejects an unregistered seller and an incorrect payment", async () => {
    const solarShare = await deployContract();
    await assert.rejects(
      solarShare.write.createOffer([1n, 1n], { account: outsider.account })
    );

    await solarShare.write.registerParticipant([3], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.createOffer([1n, 1n], { account: seller.account });

    await assert.rejects(
      solarShare.write.purchaseEnergy([0n, 1n], {
        account: buyer.account,
        value: 0n
      })
    );
  });

  it("prevents a buyer from purchasing their own offer", async () => {
    const solarShare = await deployContract();
    await solarShare.write.registerParticipant([3], { account: seller.account });
    await solarShare.write.createOffer([1n, 1n], { account: seller.account });

    await assert.rejects(
      solarShare.write.purchaseEnergy([0n, 1n], {
        account: seller.account,
        value: 1n
      })
    );
  });

  it("allows the seller to update an open offer price", async () => {
    const solarShare = await deployContract();
    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.createOffer([4n, 10n], { account: seller.account });

    await solarShare.write.updateOfferPrice([0n, 12n], { account: seller.account });
    const offer = (await solarShare.read.offers([0n])) as OfferTuple;
    assert.equal(offer[3], 12n);

    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.purchaseEnergy([0n, 1n], { account: buyer.account, value: 12n });
    await assert.rejects(
      solarShare.write.updateOfferPrice([0n, 11n], { account: seller.account })
    );
  });

  it("supports partial purchase and tracks remaining quantity", async () => {
    const solarShare = await deployContract();
    const pricePerKWh = parseEther("0.02");

    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.createOffer([10n, pricePerKWh], { account: seller.account });

    // Purchase 3 out of 10 kWh
    const purchaseHash = await solarShare.write.purchaseEnergy([0n, 3n], {
      account: buyer.account,
      value: pricePerKWh * 3n
    });
    await publicClient.waitForTransactionReceipt({ hash: purchaseHash });

    const offer = (await solarShare.read.offers([0n])) as OfferTuple;
    assert.equal(offer[2], 7n); // 10 - 3 = 7 remaining
    assert.equal(offer[4], 1); // Matched status

    // Purchase remaining 7 kWh
    const purchaseHash2 = await solarShare.write.purchaseEnergy([0n, 7n], {
      account: buyer.account,
      value: pricePerKWh * 7n
    });
    await publicClient.waitForTransactionReceipt({ hash: purchaseHash2 });

    const offer2 = (await solarShare.read.offers([0n])) as OfferTuple;
    assert.equal(offer2[2], 0n); // 0 remaining
  });

  it("rejects purchase exceeding available quantity", async () => {
    const solarShare = await deployContract();
    const pricePerKWh = parseEther("0.01");

    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.createOffer([5n, pricePerKWh], { account: seller.account });

    await assert.rejects(
      solarShare.write.purchaseEnergy([0n, 6n], {
        account: buyer.account,
        value: pricePerKWh * 6n
      })
    );
  });

  it("prevents non-seller from settling a trade", async () => {
    const solarShare = await deployContract();
    const pricePerKWh = parseEther("0.01");

    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.createOffer([5n, pricePerKWh], { account: seller.account });
    await solarShare.write.purchaseEnergy([0n, 2n], {
      account: buyer.account,
      value: pricePerKWh * 2n
    });

    // Buyer tries to settle — should fail
    await assert.rejects(
      solarShare.write.settleTrade([0n], { account: buyer.account })
    );
  });

  it("prevents double settlement", async () => {
    const solarShare = await deployContract();
    const pricePerKWh = parseEther("0.01");

    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.createOffer([5n, pricePerKWh], { account: seller.account });
    await solarShare.write.purchaseEnergy([0n, 2n], {
      account: buyer.account,
      value: pricePerKWh * 2n
    });

    // First settlement succeeds
    await solarShare.write.settleTrade([0n], { account: seller.account });

    // Second settlement fails
    await assert.rejects(
      solarShare.write.settleTrade([0n], { account: seller.account })
    );
  });

  it("transfers ETH to seller on settlement", async () => {
    const solarShare = await deployContract();
    const pricePerKWh = parseEther("0.01");

    await solarShare.write.registerParticipant([1], { account: seller.account });
    await solarShare.write.registerParticipant([2], { account: buyer.account });
    await solarShare.write.createOffer([5n, pricePerKWh], { account: seller.account });

    const sellerBalanceBefore = await publicClient.getBalance({ address: seller.account.address });

    await solarShare.write.purchaseEnergy([0n, 2n], {
      account: buyer.account,
      value: pricePerKWh * 2n
    });

    const settleHash = await solarShare.write.settleTrade([0n], { account: seller.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });

    const sellerBalanceAfter = await publicClient.getBalance({ address: seller.account.address });
    // Seller should have received 0.02 ETH (minus gas)
    assert.ok(sellerBalanceAfter > sellerBalanceBefore, "seller balance should increase after settlement");
  });
});
