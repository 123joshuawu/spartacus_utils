require("dotenv").config();

const config = require("./config.json");

const axios = require("axios").default;
const express = require("express");

const js2xmlparser = require("js2xmlparser");

const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider(config.provider.host));

const getContractAbi = async (
  address,
  apiKey = process.env.FTM_SCAN_API_KEY
) => {
  const response = await axios.get("https://api.ftmscan.com/api", {
    params: {
      module: "contract",
      action: "getabi",
      address,
      apiKey,
    },
    headers: {
      "Content-Accept": "application/json",
    },
  });

  /** @type {{status: "0"|"1"; message: string; result: string}} */
  const data = response.data;

  if (data.status !== "1") {
    throw new Error(data.message);
  }

  const abi = JSON.parse(data.result);

  return abi;
};

const getContract = async (address) => {
  const abi = await getContractAbi(address);

  const contract = new web3.eth.Contract(abi, address);

  return contract;
};

class SpaContractProvider {
  constructor(stakingAddress, sSpaAddress) {
    this.stakingAddress = stakingAddress;
    this.sSpaAddress = sSpaAddress;
  }

  async load() {
    this.stakingContract = await getContract(this.stakingAddress);

    this.sSpaContract = await getContract(this.sSpaAddress);
  }

  /** @returns {Promise<any>} */
  getEpoch() {
    return this.stakingContract.methods.epoch().call();
  }

  /** @returns {Promise<any>} */
  getCirc() {
    return this.sSpaContract.methods.circulatingSupply().call();
  }

  async getStakingStats() {
    return await Promise.all([this.getEpoch(), this.getCirc()]).then(
      ([epoch, circ]) => {
        const stakingReward = epoch.distribute;
        const stakingRebase =
          Number(stakingReward.toString()) / Number(circ.toString());
        const fiveDayRate = Math.pow(1 + stakingRebase, 5 * 3) - 1;
        const stakingAPY = Math.pow(1 + stakingRebase, 365 * 3) - 1;

        return {
          stakingRebase,
          fiveDayRate,
          stakingAPY,
        };
      }
    );
  }
}

const spaContractProvider = new SpaContractProvider(
  config.contracts.staking.address,
  config.contracts.sspa.address
);

const app = express();

app.get("/api/stats", async (req, res) => {
  try {
    const stakingStats = await spaContractProvider.getStakingStats();

    if (req.query.format === "xml") {
      res.type("application/xml");
      res.send(js2xmlparser.parse("stats", stakingStats));
      return;
    }

    res.json(stakingStats);
  } catch (err) {
    console.error(err);
    res.status(500);
  }
});

app.get("*", (req, res) => {
  res.json({ message: "hi" });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server ready");

  spaContractProvider
    .load()
    .then(() => {
      console.log("Loaded contract ABIs");
    })
    .catch((err) => {
      console.error("Failed to load contract ABIs", err);
    });
});
