// Register all protocols (side-effect imports)
import './protocols/gan';
import './protocols/giiker';
import './protocols/gocube';
import './protocols/moyu-mhc';
import './protocols/moyu32';
import './protocols/qiyi';
export { connectSmartCube } from './connect';
export { getCachedMacForDevice, removeCachedMacForDevice } from './attachment/address-hints';
export { registerProtocol, getRegisteredProtocols } from './protocol';
