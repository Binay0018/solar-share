export const solarShareAbi = [
  {
    type: "function",
    name: "purchaseEnergy",
    stateMutability: "payable",
    inputs: [
      { name: "offerId", type: "uint256" },
      { name: "kWh", type: "uint256" }
    ],
    outputs: [{ name: "tradeId", type: "uint256" }]
  },
  {
    type: "event",
    name: "TradePurchased",
    inputs: [
      { name: "tradeId", type: "uint256", indexed: true },
      { name: "offerId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "kWhTraded", type: "uint256", indexed: false },
      { name: "totalPrice", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "function",
    name: "settleTrade",
    stateMutability: "nonpayable",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "updateOfferPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerId", type: "uint256" },
      { name: "newPricePerKWh", type: "uint256" }
    ],
    outputs: []
  }
];