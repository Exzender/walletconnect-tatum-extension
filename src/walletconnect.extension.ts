import { BigNumber } from 'bignumber.js'
import { EvmRpc, TatumConfig, TatumSdkWalletProvider, ITatumSdkContainer, TxPayload,
     Constant, Utils, EVM_BASED_NETWORKS, Network } from '@tatumio/tatum'
// NOTE: TatumConnector is not exported in @tatumio/tatum - getting it directly
import { TatumConnector } from '@tatumio/tatum/dist/src/connector/tatum.connector'
// NOTE: CreateFungibleToken is not exported in @tatumio/tatum - getting it directly
import { CreateFungibleToken } from '@tatumio/tatum/dist/src/dto/walletProvider'

import { EventEmitter } from 'events'
import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import { SessionTypes, PairingTypes } from '@walletconnect/types'
import { getSdkError } from '@walletconnect/utils'

import { eipMap } from './walletConnectEip'

export class WalletConnectExtension extends TatumSdkWalletProvider<string, TxPayload> {
    supportedNetworks: Network[] = EVM_BASED_NETWORKS
    private readonly tatumConfig: TatumConfig
    private readonly rpc: EvmRpc
    private signClient: SignClient
    private session: SessionTypes.Struct | undefined
    private allNamespaceChains: string[]
    private allNamespaceAccounts: string[]
    private walletConnectModal: WalletConnectModal
    private readonly connector: TatumConnector
    readonly emitter: EventEmitter

    constructor(tatumSdkContainer: ITatumSdkContainer, private readonly wcInitOpts: any){ // wcInitOpts: SignClientTypes.Options) {
        super(tatumSdkContainer)
        this.tatumConfig = this.tatumSdkContainer.getConfig()
        this.rpc = this.tatumSdkContainer.get(EvmRpc)
        this.connector = this.tatumSdkContainer.get(TatumConnector)
        this.emitter = new EventEmitter()
    }

    async init(): Promise<void> {
        console.log('WC init');
        if (this.wcInitOpts.projectId === undefined) {

            throw new Error('WC init requires a projectId. Obtain it at https://cloud.walletconnect.com/ ')
        }

        console.dir(this.wcInitOpts);

        this.signClient = await SignClient.init(this.wcInitOpts)

        this.walletConnectModal = new WalletConnectModal({
            projectId: this.wcInitOpts.projectId!
        })

        await this._checkPersistedState();

        this.signClient.on('session_delete', () => {
            console.log('EVENT', 'session_delete');
            this.emitter.emit('wcSessionDelete');
            this.reset();
        })
    }

    destroy(): Promise<void> {
        console.log(`[ConfigurableExtension] disposed`)
        return Promise.resolve(undefined)
    }

    /**
     * Handles the event when a session is connected.
     * @param {SessionTypes.Struct} _session - The connected session.
     * @returns {void}
     */
    onSessionConnect(_session: SessionTypes.Struct) {
        this.allNamespaceAccounts = Object.values(_session.namespaces)
            .map((namespace) => namespace.accounts)
            .flat();
        this.allNamespaceChains = Object.keys(_session.namespaces);

        this.session = _session;

        console.log(this.allNamespaceChains);
        // setSolanaPublicKeys(getPublicKeysFromAccounts(allNamespaceAccounts));
    }

    /**
     * Connect to WalletConnect. This method checks if WC session exits. If not - calls WC connect method.
     * It returns the address of the connected account. If not, it throws an error.
     * @param {string[]} methods - Optional param to pass list of required methods
     * @returns address of the connected account.
     */
    async getWallet(methods?: string[]): Promise<string> {
        if (this.session) {
            // take first account from active session and decode it
            const account = this.allNamespaceAccounts[0].split(':')
            return account[2]
        }

        try {
            const _methods = methods || [
                'eth_sendTransaction',
                'personal_sign',
                // methods not used in this module
                // 'eth_signTransaction',
                // 'eth_sign',
                // 'eth_signTypedData'
            ]
            // get EIP representation of the network
            const net = eipMap.get(this.tatumConfig.network as string) || 'eip155:1'
            const { uri, approval } = await this.signClient.connect({
                // Provide the namespaces and chains (e.g. `eip155` for EVM-based chains) we want to use in this session.
                requiredNamespaces: {
                    eip155: {
                        methods: _methods,
                        chains: [net],
                        // events no used also
                        events: [] //'chainChanged', 'accountsChanged']
                    }
                }
            })

            // Open QRCode modal if a URI was returned (i.e. we're not connecting an existing pairing).
            if (uri) {
                this.walletConnectModal.openModal({uri}).then() // don't wait for modal to close
            }
            // Await session approval from the wallet.
            const _session = await approval()
            // Handle the returned session (e.g. update UI to 'connected' state).
            this.onSessionConnect(_session)

            const account = this.allNamespaceAccounts[0].split(':')
            return account[2]
        } catch (e: any) {
            console.error('User denied account access:', e)
            throw new Error(`User denied account access. Error is ${e.message}`)
        } finally {
            // Close the QRCode modal in case it was open.
            this.walletConnectModal.closeModal()
        }
    }

    /**
     * Disconnects the current session.
     * @returns {void}
     */
    async disconnect(): Promise<void> {
        if (typeof this.signClient === 'undefined') {
            throw new Error('WalletConnect is not initialized')
        }
        if (typeof this.session === 'undefined') {
            throw new Error('Session is not connected')
        }

        try {
            await this.signClient.disconnect({
                topic: this.session.topic,
                reason: getSdkError('USER_DISCONNECTED'),
            })
        } catch (error) {
            console.error(error)
            return
        }
        // Reset app state after disconnect.
        this.reset();
    }

    /**
     * Resets the state of the provider to its initial state.
     * @returns {void}
     */
    reset() {
        this.session = undefined
        this.allNamespaceAccounts = []
        this.allNamespaceChains = []
        // setBalances({});
        // setRelayerRegion(DEFAULT_RELAY_URL!);
    };

    getChainId(): string {
        if (this.allNamespaceAccounts.length) {
            const [namespace, reference] = this.allNamespaceAccounts[0].split(':')
            return `${namespace}:${reference}`
        } else {
            return 'eip155:1'
        }
    }

    /**
     * Checks the persisted state to populate existing pairings and sessions.
     * @returns {Promise<void>} A promise that resolves when the check is complete.
     */
    async _checkPersistedState (): Promise<void> {
        if (typeof this.signClient === 'undefined') {
            throw new Error('WalletConnect is not initialized');
        }
        // populates existing pairings to state
        const pairings: PairingTypes.Struct[] = this.signClient.pairing.getAll({ active: true })
        console.log('RESTORED PAIRINGS: ', pairings );

        if (typeof this.session !== 'undefined') return;

        // populates (the last) existing session to state
        if (this.signClient.session.length) {
            const lastKeyIndex = this.signClient.session.keys.length - 1;
            const _session = this.signClient.session.get(
                this.signClient.session.keys[lastKeyIndex]
            );
            console.log('RESTORED SESSION:', _session);
            this.onSessionConnect(_session)
        }
    }

    /**
     * Sign custom transaction with MetaMask wallet. This method checks if MetaMask is installed and if it is connected to the browser.
     * If so, it returns the signed transaction hash. If not, it throws an error.
     * @param payload Transaction payload. From field is ignored and will be overwritten by the connected account.
     */
    async signAndBroadcast(payload: TxPayload): Promise<string> {
        payload.from = await this.getWallet()
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/return-await
            return await this.signClient.request<string>({
                topic: this.session!.topic,
                chainId: this.getChainId(),
                request: {
                    method: 'eth_sendTransaction',
                    params: [payload]
                }
            })
        } catch (e) {
            console.error('User denied transaction signature:', e)
            throw new Error(`User denied transaction signature. Error is ${e}`)
        }
    }

    /**
     * Signs a personal message using the WalletConnect provider.
     * @param {string} message - The message to sign.
     * @returns {Promise<string>} A promise that resolves with the signed message.
     */
    async signPersonal(message: string): Promise<string> {
        // Converts a UTF-8 string to a hexadecimal string representation.
        function utf8ToHex(utf8String: string): string
        {
            const utf8encoder = new TextEncoder();

            const rb = utf8encoder.encode(utf8String);
            let r = '';
            for (const b of rb) {
                r += ('0' + b.toString(16)).slice(-2);
            }
            return r;
        }

        const address = await this.getWallet();

        // encode message to HEX
        const hexMsg = `0x${utf8ToHex(message)}`;
        // personal_sign params
        const params = [hexMsg, address];

        // send message
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/return-await
            return await this.signClient.request<string>({
                topic: this.session!.topic,
                chainId: this.getChainId(),
                request: {
                    method: 'personal_sign',
                    params: params
                }
            })
        } catch (e: any) {
            console.error('User denied message signature:', e)
            throw new Error(`User denied transaction signature. Error is ${e.message}`)
        }
    }

    /**
     * Sign native transaction with WalletConnect wallet.
     * It returns sent transaction hash. If not, it throws an error.
     * @param recipient recipient of the transaction
     * @param amount amount to be sent, in native currency (ETH, BNB, etc.)
     * @returns {Promise<string>} A promise that resolves with the transaction hash.
     */
    async transferNative(recipient: string, amount: string): Promise<string> {
        const address = await this.getWallet();

        const payload: TxPayload = {
            from: address,
            to: recipient,
            value: `0x${new BigNumber(amount)
                .multipliedBy(10 ** Constant.DECIMALS[this.tatumConfig.network])
                .toString(16)}`
        };

        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/return-await
            return await this.signClient.request<string>({
                topic: this.session!.topic,
                chainId: this.getChainId(),
                request: {
                    method: 'eth_sendTransaction',
                    params: [payload],
                },
            })
        } catch (e: any) {
            console.error('User denied transaction signature:', e)
            throw new Error(`User denied transaction signature. Error is ${e.message}`)
        }
    }


    /**
     * Sign ERC-20 fungible token `transfer` transaction (https://ethereum.org/en/developers/docs/standards/tokens/erc-20/#methods)
     * with WalletConnect wallet.
     * It returns sent transaction hash. If not, it throws an error.
     * @param recipient recipient of the transaction
     * @param amount amount to be sent, in token currency
     * @param tokenAddress address of the token contract
     * @returns {Promise<string>} A promise that resolves with the transaction hash.
     */
    async transferErc20(recipient: string, amount: string, tokenAddress: string): Promise<string> {
        const address = await this.getWallet();

        const { result: decimals } = await this.rpc.getTokenDecimals(tokenAddress)
        const payload: TxPayload = {
            to: tokenAddress,
            from: address,
            data: `0xa9059cbb${Utils.padWithZero(recipient)}${new BigNumber(amount)
                .multipliedBy(10 ** decimals!.toNumber())
                .toString(16)
                .padStart(64, '0')}`,
        }

        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/return-await
            return await this.signClient.request<string>({
                topic: this.session!.topic,
                chainId: this.getChainId(),
                request: {
                    method: 'eth_sendTransaction',
                    params: [payload],
                },
            })
        } catch (e: any) {
            console.error('User denied transaction signature:', e)
            throw new Error(`User denied transaction signature. Error is ${e.message}`)
        }
    }

    /**
     * Sign ERC-20 fungible token `approve` transaction (https://ethereum.org/en/developers/docs/standards/tokens/erc-20/#methods)
     * with WalletConnect wallet.
     * It returns the signed transaction hash. If not, it throws an error.
     * @param spender address to be approved to spend the tokens
     * @param amount amount to be sent, in token currency
     * @param tokenAddress address of the token contract
     * @returns {Promise<string>} A promise that resolves with the transaction hash.
     */
    async approveErc20(spender: string, amount: string, tokenAddress: string): Promise<string> {
        const address = await this.getWallet();

        const { result: decimals } = await this.rpc.getTokenDecimals(tokenAddress)
        const payload: TxPayload = {
            to: tokenAddress,
            from: address,
            data: `0x095ea7b3${Utils.padWithZero(spender)}${new BigNumber(amount)
                .multipliedBy(10 ** decimals!.toNumber())
                .toString(16)
                .padStart(64, '0')}`,
        }
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/return-await
            return await this.signClient.request<string>({
                topic: this.session!.topic,
                chainId: this.getChainId(),
                request: {
                    method: 'eth_sendTransaction',
                    params: [payload],
                },
            })
        } catch (e: any) {
            console.error('User denied transaction signature:', e)
            throw new Error(`User denied transaction signature. Error is ${e.message}`)
        }
    }


    /**
     * Deploy new ERC-20 Token (USDT or USDC like) contract with WalletConnect wallet.
     * It returns the signed transaction hash. If not, it throws an error.
     * @param body Fungible token parameters.
     * @returns {Promise<string>} A promise that resolves with the transaction hash.
     */
    async createFungibleToken(body: CreateFungibleToken): Promise<string> {
        const from = await this.getWallet();
        const decimals = body.decimals || 18
        const { data } = await this.connector.post<{ data: string }>({
            path: `contract/deploy/prepare`,
            body: {
                contractType: 'fungible',
                params: [
                    body.name,
                    body.symbol,
                    decimals,
                    `0x${new BigNumber(body.initialSupply).multipliedBy(10 ** decimals).toString(16)}`,
                    body.initialHolder || from,
                    body.admin || from,
                    body.minter || from,
                    body.pauser || from,
                ],
            },
        })
        const payload: TxPayload = {
            from: from,
            data,
        }
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/return-await
            return await this.signClient.request<string>({
                topic: this.session!.topic,
                chainId: this.getChainId(),
                request: {
                    method: 'eth_sendTransaction',
                    params: [payload],
                },
            })
        } catch (e: any) {
            console.error('User denied transaction signature:', e)
            throw new Error(`User denied transaction signature. Error is ${e.message}`)
        }
    }
}
