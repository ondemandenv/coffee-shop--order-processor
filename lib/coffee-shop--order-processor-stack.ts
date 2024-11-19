import * as cdk from 'aws-cdk-lib';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import {DefinitionBody, InputType, IntegrationPattern, Timeout} from "aws-cdk-lib/aws-stepfunctions";
import {DynamoAttributeValue, DynamoReturnValues} from "aws-cdk-lib/aws-stepfunctions-tasks";
import {Construct} from "constructs";
import {Duration} from "aws-cdk-lib";
import {EventBus, Rule} from "aws-cdk-lib/aws-events";
import {Table} from "aws-cdk-lib/aws-dynamodb";
import {SfnStateMachine} from "aws-cdk-lib/aws-events-targets";
import {CoffeeShopOrderProcessorEnver, OndemandContractsSandbox} from "@ondemandenv/odmd-contracts-sandbox";

export class CoffeeShopOrderProcessorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);


        const myEnver = OndemandContractsSandbox.inst.getTargetEnver() as CoffeeShopOrderProcessorEnver
        const eventBus = EventBus.fromEventBusName(this, 'eventBus', myEnver.eventBus.getSharedValue(this))
        const source = myEnver.eventSrc.getSharedValue(this) as string

        const configTable = Table.fromTableName(this, 'configTable', myEnver.configTableName.getSharedValue(this))
        const countingTable = Table.fromTableName(this, 'countTableName', myEnver.countTableName.getSharedValue(this))

        const stateMachineName = myEnver.owner.buildId + '-' + myEnver.targetRevision.value + '-order_processor'

        const emitOrderFinished = new tasks.EventBridgePutEvents(this, 'Emit - order finished', {
            entries: [
                {
                    eventBus,
                    source,
                    detailType: 'OrderProcessor.orderFinished',
                    detail: {
                        type: InputType.OBJECT,
                        value: {
                            Message: "orderFinished",
                            "orderId.$": "$.detail.orderId",
                            "userId.$": "$.detail.userId",
                            "orderNumber.$": "$.Order.Payload.orderNumber"
                        }
                    }
                },
            ],
            resultPath: '$.kkkk',
        });


        const errorTimeOutEnd = new tasks.EventBridgePutEvents(this, 'Emit - errorTimeOutEnd', {
            entries: [
                {
                    eventBus,
                    source,
                    detailType: 'OrderProcessor.errorTimeOutEnd',
                    detail: {
                        type: InputType.OBJECT,
                        value: {
                            Message: "errorTimeOutEnd",
                            "orderId.$": "$.detail.orderId",
                            "userId.$": "$.detail.userId",
                            "orderNumber.$": "$.Order.Payload.orderNumber"
                        }
                    }
                },
            ],
            resultPath: '$.aaabbc',
        });
        const shopNotReady = new tasks.EventBridgePutEvents(this, 'Emit - Shop not ready', {
            entries: [
                {
                    eventBus,
                    source,
                    detailType: 'OrderProcessor.orderFinished',
                    detail: {
                        type: InputType.OBJECT,
                        value: {msg: 'msg123'}
                    }
                },
            ],
        });


        const getStoreStatusPath = '$.GetStore';
        const definition = new tasks.DynamoGetItem(this, 'DynamoDB Get Shop status', {
            table: configTable,
            key: {
                PK: DynamoAttributeValue.fromString('config')
            },
            resultPath: getStoreStatusPath,
        }).next(
            new sfn.Choice(this, 'Shop Open?')
                .when(
                    sfn.Condition.booleanEquals(sfn.JsonPath.stringAt(getStoreStatusPath + '.Item.storeOpen.BOOL'), true),

                    new tasks.CallAwsService(this, 'ListExecutions', {
                        service: 'sfn',
                        action: 'listExecutions',
                        parameters: {
                            StateMachineArn: `arn:aws:states:${this.region}:${this.account}:stateMachine:${stateMachineName}`,
                            MaxResults: 100,
                            StatusFilter: 'RUNNING'
                        },
                        resultPath: '$.isCapacityAvailable',
                        iamResources: ['*']
                    })
                        .next(new sfn.Choice(this, 'is capacity available?')
                            .when(
                                sfn.Condition.isNotPresent(sfn.JsonPath.stringAt('$.isCapacityAvailable.Executions[20]')),

                                new tasks.EventBridgePutEvents(this, 'Emit - Workflow Started TT', {
                                    entries: [{
                                        eventBus,
                                        source,
                                        detailType: OndemandContractsSandbox.inst.coffeeShopOrderProcessorCdk.WORKFLOW_STARTED,

                                        detail: {
                                            type: InputType.OBJECT,
                                            value: {
                                                TaskToken: sfn.JsonPath.taskToken,
                                                Message: "The workflow waits for your order to be submitted. It emits an event with a unique 'task token'. The token is stored in an Amazon DynamoDB table, along with your order ID.",
                                                "orderId.$": "$.detail.orderId",
                                                "userId.$": "$.detail.userId",
                                            }
                                        }
                                    }],
                                    integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
                                    resultPath: '$.fk',
                                    heartbeatTimeout: Timeout.duration(Duration.seconds(900)),
                                    // taskTimeout: Timeout.duration(Duration.minutes(5)),
                                }).addCatch(
                                    errorTimeOutEnd, {resultPath: '$.fk'}
                                ).next(
                                    new tasks.DynamoUpdateItem(this, 'Generate Order Number', {
                                            table: countingTable,
                                            key: {
                                                PK: DynamoAttributeValue.fromString('orderID') // Replace with actual key value
                                            },
                                            updateExpression: 'set IDvalue = IDvalue + :val',
                                            expressionAttributeValues: {
                                                ':val': DynamoAttributeValue.fromNumber(1)
                                            },
                                            returnValues: DynamoReturnValues.UPDATED_NEW,
                                            resultSelector: {
                                                orderNumber: sfn.JsonPath.stringAt('$.Attributes.IDvalue.N')
                                            },
                                            resultPath: '$.Order.Payload',
                                        }
                                    ).next(
                                        new tasks.EventBridgePutEvents(this, 'Emit - Awaiting Completion TT', {
                                            entries: [
                                                {
                                                    eventBus,
                                                    source,
                                                    detailType: 'OrderProcessor.WaitingCompletion',
                                                    detail: {
                                                        type: InputType.OBJECT,
                                                        value: {
                                                            TaskToken: sfn.JsonPath.taskToken,
                                                            Message: "You pressed 'submit order'. The workflow resumes using the stored 'task token', it generates your order number. It then pauses again, emitting an event with a new 'task token'.",
                                                            "orderId.$": "$.detail.orderId",
                                                            "userId.$": "$.detail.userId",
                                                            "orderNumber.$": "$.Order.Payload.orderNumber"
                                                        }
                                                    }
                                                }
                                            ],
                                            integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
                                            resultPath: '$.order',
                                            heartbeatTimeout: Timeout.duration(Duration.seconds(900)),
                                            // taskTimeout: Timeout.duration(Duration.minutes(5))
                                        }).addCatch(
                                            errorTimeOutEnd, {resultPath: '$.fk'}
                                        ).next(emitOrderFinished)
                                    )
                                )
                            )
                            .otherwise(
                                shopNotReady
                            ).afterwards()
                        )
                )
                .otherwise(shopNotReady)
        )

        const states = new sfn.StateMachine(this, 'MyStateMachine', {
            definitionBody: DefinitionBody.fromChainable(definition),
            stateMachineName
        });

        configTable.grantFullAccess(states)
        countingTable.grantFullAccess(states)

        new Rule(this, 'Rule', {
            eventBus,
            eventPattern: {source: [eventBus.eventBusName], detailType: ["Validator.NewOrder"],},
            targets: [new SfnStateMachine(states)]
        })


    }
}
