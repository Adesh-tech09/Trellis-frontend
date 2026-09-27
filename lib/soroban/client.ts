import * as StellarSdk from "@stellar/stellar-sdk";
import {
    StellarNetwork,
    SorobanContractSpec,
    ResourceMetrics,
    SorobanTransactionResult
} from "../types";
import { STELLAR_NETWORKS } from "../stellar-constants";
import { specLoader } from "./spec";

/**
 * Robust Soroban contract interaction client
 */
export class SorobanContract {
    private server: any;
    private networkPassphrase: string;
    private contract: StellarSdk.Contract;

    constructor(
        public readonly contractId: string,
        public readonly network: StellarNetwork,
        public readonly spec?: SorobanContractSpec
    ) {
        const config = STELLAR_NETWORKS[network];
        const rpcUrl = config.rpcUrl || config.horizonUrl.replace("horizon", "soroban-rpc");
        this.server = new (StellarSdk as any).rpc.Server(rpcUrl);
        this.networkPassphrase = config.networkPassphrase;
        this.contract = new StellarSdk.Contract(contractId);
    }

    /**
     * Simulate a contract call (Read-only)
     */
    async callReadOnly(
        functionName: string,
        args: any[] = []
    ): Promise<{ result: any; metrics: ResourceMetrics }> {
        try {
            // Mock account for simulation if no signer provided
            const dummyAccount = new StellarSdk.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");

            const tx = new StellarSdk.TransactionBuilder(dummyAccount, {
                fee: "100",
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(this.contract.call(functionName, ...this.prepareArgs(functionName, args)))
                .setTimeout(StellarSdk.TimeoutInfinite)
                .build();

            const response = await this.server.simulateTransaction(tx);

            if ((StellarSdk as any).rpc.Api.isSimulationSuccess(response)) {
                const result = response.results[0];
                const scValResult = StellarSdk.xdr.ScVal.fromXDR(result.xdr, "base64");

                return {
                    result: StellarSdk.scValToNative(scValResult),
                    metrics: this.extractMetrics(response),
                };
            } else {
                throw new Error(`Simulation failed: ${JSON.stringify(response)}`);
            }
        } catch (error) {
            console.error(`Error in callReadOnly (${functionName}):`, error);
            throw error;
        }
    }

    /**
     * Pre-flight contract transaction simulation to validate execution and estimate resources
     */
    async simulateTransaction(
        functionName: string,
        args: any[],
        publicKey: string
    ): Promise<{
        transaction: StellarSdk.Transaction;
        metrics: ResourceMetrics;
        simulationResponse: any;
        minResourceFee: number;
    }> {
        try {
            const server = new StellarSdk.Horizon.Server(STELLAR_NETWORKS[this.network].horizonUrl);
            const account = await server.loadAccount(publicKey);

            let tx = new StellarSdk.TransactionBuilder(account, {
                fee: "100", // Placeholder, will be updated by simulation
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(this.contract.call(functionName, ...this.prepareArgs(functionName, args)))
                .setTimeout(StellarSdk.TimeoutInfinite)
                .build();

            const simulationResponse = await this.server.simulateTransaction(tx);

            if (!(StellarSdk as any).rpc.Api.isSimulationSuccess(simulationResponse)) {
                const errorMsg = decodeSimulationError(simulationResponse);
                throw new Error(`Simulation failed: ${errorMsg}`);
            }

            // Assemble the full transaction with simulation results
            tx = (StellarSdk as any).rpc.assembleTransaction(tx, simulationResponse).build();
            const metrics = this.extractMetrics(simulationResponse);
            const minResourceFee = Number(simulationResponse.minResourceFee || 0);

            return {
                transaction: tx,
                metrics,
                simulationResponse,
                minResourceFee,
            };
        } catch (error) {
            console.error(`Error in simulateTransaction (${functionName}):`, error);
            throw error;
        }
    }

    /**
     * Prepare a transaction for invocation (State-changing)
     */
    async prepareInvoke(
        functionName: string,
        args: any[],
        publicKey: string
    ): Promise<{ transaction: StellarSdk.Transaction; metrics: ResourceMetrics; minResourceFee?: number }> {
        const result = await this.simulateTransaction(functionName, args, publicKey);
        return {
            transaction: result.transaction,
            metrics: result.metrics,
            minResourceFee: result.minResourceFee,
        };
    }

    /**
     * Helper to extract resource metrics from simulation response
     */
    public extractMetrics(response: any): ResourceMetrics {
        const minFee = Number(response?.minResourceFee || 0);
        const cost = response?.cost || {};

        let ledgerReadBytes = 0;
        let ledgerWriteBytes = 0;
        let readCount = 0;
        let writeCount = 0;

        try {
            let txData = response?.transactionData;
            if (typeof txData === "string" && (StellarSdk as any).xdr?.SorobanTransactionData) {
                try {
                    txData = (StellarSdk as any).xdr.SorobanTransactionData.fromXDR(txData, "base64");
                } catch {
                    // Ignore decoding error if mock or invalid XDR
                }
            }

            if (txData && typeof txData.resources === "function") {
                const res = txData.resources();
                if (res) {
                    if (typeof res.readBytes === "function") ledgerReadBytes = Number(res.readBytes());
                    if (typeof res.writeBytes === "function") ledgerWriteBytes = Number(res.writeBytes());
                    const footprint = typeof res.footprint === "function" ? res.footprint() : null;
                    if (footprint) {
                        if (typeof footprint.readOnly === "function") readCount = footprint.readOnly().length;
                        if (typeof footprint.readWrite === "function") writeCount = footprint.readWrite().length;
                    }
                }
            } else if (txData && txData.resources) {
                const res = txData.resources;
                ledgerReadBytes = Number(res.readBytes || 0);
                ledgerWriteBytes = Number(res.writeBytes || 0);
                if (res.footprint) {
                    readCount = res.footprint.readOnly?.length || 0;
                    writeCount = res.footprint.readWrite?.length || 0;
                }
            }
        } catch (e) {
            // Fallback gracefully on parsing errors
        }

        return {
            cpuInstructions: Number(cost.cpuInsns || 0),
            ramBytes: Number(cost.memBytes || 0),
            ledgerReadBytes,
            ledgerWriteBytes,
            readCount,
            writeCount,
            costXlm: (minFee / 10000000).toFixed(7),
            minResourceFee: String(minFee),
        };
    }

    /**
     * Internal helper to map args based on spec (if available) or native conversion
     */
    private prepareArgs(functionName: string, args: any[]): StellarSdk.xdr.ScVal[] {
        // If we have a spec, we could do more advanced mapping here
        return args.map(arg => StellarSdk.nativeToScVal(arg));
    }
}

/**
 * Decodes simulation error response from Soroban RPC into a human-readable string
 */
export function decodeSimulationError(response: any): string {
    if (!response) return "Unknown simulation error";
    if (typeof response === "string") return response;
    if (response.error) {
        return typeof response.error === "string" ? response.error : JSON.stringify(response.error);
    }
    if (Array.isArray(response.results) && response.results.length > 0) {
        const first = response.results[0];
        if (first.error) {
            return typeof first.error === "string" ? first.error : JSON.stringify(first.error);
        }
        if (first.xdr) {
            return `Contract execution error (XDR: ${first.xdr})`;
        }
    }
    return "Transaction simulation failed pre-flight check";
}

/**
 * Factory class for managing Soroban contract instances
 */
export class SorobanContractFactory {
    private instances: Map<string, SorobanContract> = new Map();

    constructor(private network: StellarNetwork) { }

    async getContract(contractId: string, specJson?: any): Promise<SorobanContract> {
        const key = `${this.network}:${contractId}`;
        if (this.instances.has(key)) {
            return this.instances.get(key)!;
        }

        let spec: SorobanContractSpec | undefined;
        if (specJson) {
            spec = await specLoader.loadFromJson(contractId, specJson);
        }

        const instance = new SorobanContract(contractId, this.network, spec);
        this.instances.set(key, instance);
        return instance;
    }
}
