#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {StackProps} from "aws-cdk-lib";
import {CoffeeShopOrderProcessorStack} from "../lib/coffee-shop--order-processor-stack";
import {OndemandContractsSandbox} from "@ondemandenv/odmd-contracts-sandbox";
import {OdmdEnverCdk} from "@ondemandenv/contracts-lib-base";

const app = new cdk.App();


async function main() {

    const buildRegion = process.env.CDK_DEFAULT_REGION;
    const buildAccount = process.env.CDK_DEFAULT_ACCOUNT;
    if (!buildRegion || !buildAccount) {
        throw new Error("buildRegion>" + buildRegion + "; buildAccount>" + buildAccount)
    }

    const props = {
        env: {
            account: buildAccount,
            region: buildRegion
        }
    } as StackProps;

    new OndemandContractsSandbox(app)

    const targetEnver = OndemandContractsSandbox.inst.getTargetEnver() as OdmdEnverCdk

    new CoffeeShopOrderProcessorStack(app, targetEnver.getRevStackNames()[0], props)
}


console.log("main begin.")
main().catch(e => {
    console.error(e)
    throw e
}).finally(() => {
    console.log("main end.")
})