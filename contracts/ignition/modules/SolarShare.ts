import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const SolarShareModule = buildModule("SolarShareModule", (module) => {
  const solarShare = module.contract("SolarShare");
  return { solarShare };
});

export default SolarShareModule;
