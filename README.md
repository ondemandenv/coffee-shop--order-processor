# Coffee Shop Order Processor Service

**Order Fulfillment Processing Service for the ONDEMANDENV Coffee Shop Demo**

This service demonstrates **parallel service development** and **shared infrastructure consumption** within the ONDEMANDENV platform, showing how multiple teams can independently build services that consume the same foundation while maintaining complete development isolation.

## Service Overview

The Order Processor service handles **order fulfillment processing** for the coffee shop application:

- **Payment Processing**: Secure payment validation and charging
- **Inventory Management**: Real-time stock updates and allocation
- **Fulfillment Coordination**: Kitchen workflow and delivery scheduling
- **Event Processing**: React to order lifecycle events from other services

## Architecture Role

```
┌─────────────────────────────────────────────────────────────┐
│                    Coffee Shop Architecture                 │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ Order Manager   │    │ Order Processor  │               │
│  │                 │    │ ◄── You Are Here │               │
│  │ Consumes:       │    │                  │               │
│  │ • Event Bus     │    │ Consumes:        │               │
│  │ • Config Table  │    │ • Event Bus      │               │
│  │ • Counter Table │    │ • Config Table   │               │
│  │                 │    │ • Counter Table  │               │
│  │ Publishes:      │    │                  │               │
│  │ • Order Events  │    │ Publishes:       │               │
│  │                 │    │ • Fulfillment    │               │
│  │                 │    │   Events         │               │
│  └─────────────────┘    └──────────────────┘               │
│           │                       │                        │
│           └───────────┬───────────┘                        │
│                       │                                    │
│                       ▼                                    │
│           ┌─────────────────────────┐                      │
│           │    Foundation Service   │                      │
│           │                         │                      │
│           │ Publishes:              │                      │
│           │ • Event Bus Source      │                      │
│           │ • Configuration Table   │                      │
│           │ • Counter Table         │                      │
│           └─────────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Contract Definition

This service's dependency contracts are defined in [`contracts-sandbox`](../../contracts-sandbox):

```typescript
// contracts-sandbox/lib/repos/coffee-shop/coffee-shop-order-processor-cdk.ts
export class CoffeeShopOrderProcessorEnver extends OdmdEnverCdk {
    // Consumes SAME services as Order Manager (parallel development)
    readonly eventBus: OdmdCrossRefConsumer<CoffeeShopOrderProcessorEnver, CoffeeShopFoundationEnver>;
    readonly eventSrc: OdmdCrossRefConsumer<CoffeeShopOrderProcessorEnver, CoffeeShopFoundationEnver>;
    readonly configTableName: OdmdCrossRefConsumer<CoffeeShopOrderProcessorEnver, CoffeeShopFoundationEnver>;
    readonly countTableName: OdmdCrossRefConsumer<CoffeeShopOrderProcessorEnver, CoffeeShopFoundationEnver>;
}
```

## Consumed Services

### **From Foundation Service** (`coffee-shop-foundation`)

#### 1. Event Bus (`eventBus` + `eventSrc`)
- **Purpose**: Listen for order events and publish processing updates
- **Usage**: React to order creation, publish payment/fulfillment status
- **Pattern**: Event-driven processing pipeline

#### 2. Configuration Table (`configTableName`)
- **Purpose**: Processing parameters and business rules
- **Usage**: Payment timeouts, inventory thresholds, processing flags
- **Pattern**: Dynamic configuration for operational flexibility

#### 3. Counter Table (`countTableName`)
- **Purpose**: Processing metrics and performance tracking
- **Usage**: Processing rates, success/failure counts, SLA metrics
- **Pattern**: Real-time operational dashboards

## ONDEMANDENV Concepts Demonstrated

### **Parallel Development**
This service demonstrates how **multiple teams can work independently** on services that consume the same foundation:

```typescript
// Both Order Manager AND Order Processor consume the same foundation
// But develop completely independently with isolated environments
const foundationCdk = owner.contracts.coffeeShopFoundationCdk.theOne;
this.eventBus = new OdmdCrossRefConsumer(this, 'eventBus', foundationCdk.eventBusSrc);
```

### **Shared Infrastructure, Independent Development**
- **Same Dependencies**: Consumes identical foundation services as Order Manager
- **Different Responsibility**: Handles fulfillment vs. order lifecycle  
- **Independent Environments**: Each service team can clone and test independently
- **No Coordination Required**: Teams don't need to coordinate deployments

### **Event-Driven Decoupling**
Services communicate through events rather than direct coupling:
- Order Manager publishes order events
- Order Processor reacts to those events
- Neither service knows about the other's implementation

## Business Logic Implementation

### **Payment Processing**
```typescript
// Example: Processing payment events
const paymentHandler = new lambda.Function(this, 'PaymentProcessor', {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: 'payment.handler',
    code: lambda.Code.fromAsset('src'),
    environment: {
        EVENT_BUS_NAME: eventBusName,
        CONFIG_TABLE: configTableName
    }
});

// Listen for order creation events
new events.Rule(this, 'OrderCreatedRule', {
    eventPattern: {
        source: ['coffee-shop.order-manager'],
        detailType: ['Order Created']
    },
    targets: [new targets.LambdaFunction(paymentHandler)]
});
```

### **Inventory Management**
```typescript
// Example: Real-time inventory updates
await dynamodb.updateItem({
    TableName: countTableName,
    Key: { item: { S: productId } },
    UpdateExpression: 'ADD available :delta',
    ExpressionAttributeValues: { ':delta': { N: (-quantity).toString() } },
    ConditionExpression: 'available >= :required',
    ExpressionAttributeNames: { ':required': { N: quantity.toString() } }
});
```

### **Fulfillment Events**
```typescript
// Example: Publishing fulfillment status
await eventBridge.putEvents({
    Entries: [{
        Source: 'coffee-shop.order-processor',
        DetailType: 'Payment Processed',
        Detail: JSON.stringify({
            orderId: order.id,
            paymentId: payment.id,
            status: 'PAID',
            timestamp: new Date().toISOString()
        })
    }]
});
```

## Development Workflow

### **Independent Team Development**
```bash
# Order Processor team works independently of Order Manager team
git checkout -b feature/faster-payment-processing
git commit -m "feat: optimized payment flow

odmd: create@master"

# Creates complete environment:
# 1. Order Processor from feature branch
# 2. Foundation service (shared infrastructure)
# 3. Can test without Order Manager team coordination
```

### **Cross-Service Integration Testing**
```bash
# Test with other services using on-demand environments
git commit -m "test: integration with order manager

odmd: create@master"

# This creates an environment where:
# - Order Processor uses your feature branch
# - Order Manager uses master branch  
# - Foundation provides shared event bus
# - Complete end-to-end testing possible
```

### **Parallel Feature Development**
- **Order Manager team**: Can develop order validation features
- **Order Processor team**: Can develop payment optimizations
- **Foundation team**: Can improve shared infrastructure
- **All simultaneously**: Each in their own isolated environments

## Service Integration Patterns

### **Event-Driven Processing Pipeline**
```typescript
// React to order lifecycle events
const orderEventProcessing = new stepfunctions.StateMachine(this, 'OrderProcessing', {
    definition: stepfunctions.Chain
        .start(validatePayment)
        .next(allocateInventory)
        .next(scheduleDelivery)
        .next(notifyCompletion)
});

// Trigger on order events
new events.Rule(this, 'ProcessOrderRule', {
    eventPattern: {
        source: ['coffee-shop.order-manager'],
        detailType: ['Order Confirmed']
    },
    targets: [new targets.SfnStateMachine(orderEventProcessing)]
});
```

### **Circuit Breaker Pattern**
```typescript
// Handle external service failures gracefully
const paymentProcessor = new lambda.Function(this, 'PaymentProcessor', {
    reservedConcurrency: 100,
    timeout: Duration.seconds(30),
    retryAttempts: 2,
    onFailure: new destinations.SqsDestination(dlq)
});
```

## Monitoring & Operations

### **Processing Metrics**
- **Payment Success Rate**: Track transaction processing health
- **Inventory Accuracy**: Monitor stock level consistency
- **Processing Latency**: End-to-end fulfillment timing
- **Error Rates**: Failed payments, insufficient inventory

### **Business Intelligence**
```typescript
// Track business metrics in shared counter table
await dynamodb.updateItem({
    TableName: countTableName,
    Key: { metric: { S: 'revenue-today' } },
    UpdateExpression: 'ADD amount :revenue',
    ExpressionAttributeValues: { ':revenue': { N: orderTotal.toString() } }
});
```

## Testing Strategy

### **Independent Service Testing**
```bash
# Test processor logic without order manager
npm run test:unit

# Test against real foundation in isolation
odmd: create@master
npm run test:integration
odmd: delete
```

### **Cross-Service Integration**
```bash
# Test complete order-to-fulfillment flow
odmd: create@master
npm run test:e2e  # Tests order creation → processing → fulfillment
odmd: delete
```

### **Load Testing**
```bash
# Test processing capacity in isolated environment
odmd: create@master
npm run test:load  # Simulate high order volumes
odmd: delete
```

## Team Coordination

### **Contract-Based Collaboration**
Teams coordinate through **explicit contracts** rather than direct communication:

1. **Event Schemas**: Agreed-upon event structures in contracts
2. **Service Boundaries**: Clear responsibility separation
3. **Dependency Versions**: Explicit version declarations
4. **Interface Evolution**: Contract changes require team agreement

### **Independent Release Cycles**
- Order Manager can release new features independently
- Order Processor can optimize payment flows independently  
- Foundation can upgrade infrastructure independently
- Platform ensures compatibility through contract validation

## Getting Started

1. **Understand Shared Architecture**: Review how this service relates to [`order-manager`](../coffee-shop--order-manager) - same dependencies, different responsibilities

2. **Explore Foundation**: Understand shared services provided by [`coffee-shop-foundation`](../coffee-shop--foundation)

3. **Study Contracts**: Review the dependency declarations in [`contracts-sandbox`](../../contracts-sandbox/lib/repos/coffee-shop/coffee-shop-order-processor-cdk.ts)

4. **Deploy & Test**:
   ```bash
   # Create isolated development environment
   git commit -m "test: exploring order processing

   odmd: create@master"
   
   # Deploy and test processing logic
   npx cdk deploy
   ```

5. **Learn Platform**: Visit [ONDEMANDENV documentation](../ondemandenv.github.io) for comprehensive guides

## Key Benefits Demonstrated

- **Parallel Development**: Multiple teams develop services consuming same infrastructure
- **Team Independence**: No coordination required for feature development
- **Shared Infrastructure**: Efficient resource utilization through foundation services
- **Event-Driven Architecture**: Loose coupling enables independent evolution
- **Safe Experimentation**: Isolated environments prevent cross-team interference  
- **Contract-Driven Collaboration**: Explicit agreements replace implicit dependencies

This service showcases how ONDEMANDENV enables **true microservice team autonomy** while maintaining **system coherence** through shared infrastructure and explicit contracts. Teams can move at their own pace while the platform ensures everything works together seamlessly.
