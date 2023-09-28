# ⚙️️ WalletConnect Extension for use with Tatum SDK

The WalletConnect Extension adds WalletConnect v2 support to Tatum SDK.
Current version supports only EVM networks, supported by Tatum SDK.

## Base for the project

🔗 TatumSDK - https://github.com/tatumio/tatum-js <br />
🔗 TatumSDK extensions - https://github.com/tatumio/ecosystem-addons <br />
🔗 WalletConnect - https://github.com/WalletConnect

## 🛠️ How to Use

Install the app's dependencies:

```bash
npm install @tatumio/tatum
npm install walletconnect-extension
```

## Working with WalletConnect provider

WalletConnect requires provider initialization. \
Each add/dApp using WalletConnect should have PROJECT_ID, which can be obtained [here](https://cloud.walletconnect.com/)

Initialization object also could have metadata and other parameters.

```ts
const wcInitOpts = {
    projectId: PROJECT_ID,
    // optional parameters
    // relayUrl: '<YOUR RELAY URL>',
    metadata: {
        name: 'Test Tatum Dapp',
        description: 'Test Tatum Dapp',
        url: '#',
        icons: ['https://walletconnect.com/walletconnect-logo.png']
    }
}
```
Initialization of Tatum SDK with WalletConnect extension:

```ts
import { TatumSDK, Network } from "@tatumio/tatum"
import { WalletConnectExtension } from "walletconnect-extension" 

const tatum = await TatumSDK.init<Ethereum>({
    network: Network.ETHEREUM,
    configureWalletProviders: [
        {type: WalletConnectExtension, config: wcInitOpts}]

})
```
Now provider can connect:
```ts
const wcAccount: string = await tatum.walletProvider.use(WalletConnectExtension).getWallet()
console.log(wcAccount)
```
To be able to respond to WalletConnect events watch for events from emitter. \
Only `wcSessionDelete` event implemented - appears when the user disconnects session from its wallet.
```ts
tatum.walletProvider.use(WalletConnectExtension).emitter.on('wcSessionDelete', (() => console.log('disconnected')))
```

### Implemented functions

```ts
getWallet()  // connect & return connected address
disconnect() // close current connection
signAndBroadcast()  // set already prepared transaction (= customPayload)
signPersonal()   // sign text message
transferNative() // sign & transfer coin native for active chain
transferErc20()  // sign & transfer ERC20 token
approveErc20()   // approve spending of ERC20 token to provided contract address
createFungibleToken() // create custom ERC20 token
```

### To pack this extension locally, execute the following steps:

```bash
yarn install
yarn build
yarn pack
```

Keep a record of the output path for the .tgz file. You'll refer to it when updating the `package.json` of your test application.

## Contacts

[LinkedIn](https://www.linkedin.com/in/aleksandr-s-terekhov/)