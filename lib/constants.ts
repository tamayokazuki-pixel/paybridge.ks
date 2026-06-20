export const siteName = "paybridge.ks";

export const defaultPaymentMethods = [
  {
    key: "bitcoin",
    label: "Bitcoin (BTC)",
    fields: [{ label: "BTC Wallet Address", value: "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf" }]
  },
  {
    key: "ethereum",
    label: "Ethereum (ETH)",
    fields: [{ label: "ETH Wallet Address", value: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" }]
  },
  {
    key: "usdt_trc20",
    label: "USDT - TRC20",
    fields: [{ label: "TRC20 Wallet Address", value: "TGj1Ej1qRzL9feLTLhjwgxXF4Ct6GTWg2U" }]
  },
  {
    key: "wire",
    label: "Wire Transfer (SWIFT)",
    fields: [
      { label: "Bank Name", value: "paybridge.ks Bank" },
      { label: "Account Name", value: "paybridge.ks Ltd" },
      { label: "Account Number", value: "0012345678" },
      { label: "SWIFT / BIC", value: "PBRGUS33XXX" }
    ]
  }
];

export const accountTypes = [
  "Personal Checking",
  "Personal Savings",
  "Business Checking",
  "Business Savings",
  "Student Account"
];

export const currencies = [
  "USD - US Dollar",
  "GBP - British Pound",
  "EUR - Euro",
  "NGN - Nigerian Naira",
  "GHS - Ghanaian Cedi",
  "KES - Kenyan Shilling",
  "ZAR - South African Rand",
  "CAD - Canadian Dollar",
  "AUD - Australian Dollar"
];
