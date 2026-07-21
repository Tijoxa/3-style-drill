const protocolRegistry = [];
function registerProtocol(protocol) {
    protocolRegistry.push(protocol);
}
function getRegisteredProtocols() {
    return protocolRegistry;
}
export { registerProtocol, getRegisteredProtocols };
