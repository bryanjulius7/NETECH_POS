// tests/ck_orders.test.js
const path = require("path");
const { readFileSync } = require("fs");
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require("@firebase/rules-unit-testing");

// 👇 Match your emulator settings (change port if yours differs)
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8081;

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "demo-test-ck-orders",
        firestore: {
            host: FIRESTORE_HOST,
            port: FIRESTORE_PORT,
            rules: readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
        },
    });
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
});

// ---- helpers ----
function staffCtx({
    uid = "staff-stf001",
    companyId = "NE001",
    storeId = "TP01",
    userId = "STF001",
} = {}) {
    return testEnv.authenticatedContext(uid, {
        role: "staff",
        companyId,
        storeId,
        userId,
    });
}

function adminCtx({ uid = "admin-ne001", companyId = "NE001" } = {}) {
    return testEnv.authenticatedContext(uid, { role: "admin", companyId });
}

function adminOtherCompanyCtx() {
    return testEnv.authenticatedContext("admin-ne002", {
        role: "admin",
        companyId: "NE002",
    });
}

describe("Central Kitchen Orders rules", () => {
    test("Staff can CREATE for their own store/company (status defaults/Requested)", async () => {
        const db = staffCtx().firestore();
        const ref = db.collection("central_kitchen_orders").doc();

        await assertSucceeds(
            ref.set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-CHICK", qty: 3 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested", // allowed; could also omit and let rules allow missing/Requested
            })
        );
    });

    test("Staff CANNOT CREATE for another store/company", async () => {
        const db = staffCtx({ storeId: "TP01" }).firestore();
        const ref = db.collection("central_kitchen_orders").doc();

        await assertFails(
            ref.set({
                companyId: "NE001",
                storeId: "TP99", // different from staff claim
                items: [{ sku: "X", qty: 1 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            })
        );
    });

    test("Staff CANNOT UPDATE after creation", async () => {
        // Seed a valid doc as staff first
        const staff = staffCtx();
        const db = staff.firestore();
        const ref = db.collection("central_kitchen_orders").doc("O1");

        await assertSucceeds(
            ref.set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-DUCK", qty: 2 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            })
        );

        // Try to mutate (should be denied by rules)
        await assertFails(
            ref.update({
                status: "Confirmed",
            })
        );
    });

    test("Admin of SAME company can READ any order", async () => {
        // Seed with rules disabled
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().collection("central_kitchen_orders").doc("O2").set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-VEG", qty: 5 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            });
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertSucceeds(
            adminDb.collection("central_kitchen_orders").doc("O2").get()
        );
    });

    test("Admin of OTHER company CANNOT READ", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().collection("central_kitchen_orders").doc("O3").set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-TOFU", qty: 1 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            });
        });

        const otherAdminDb = adminOtherCompanyCtx().firestore();
        await assertFails(
            otherAdminDb.collection("central_kitchen_orders").doc("O3").get()
        );
    });

    test("Admin can UPDATE status from Requested -> Confirmed", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().collection("central_kitchen_orders").doc("O4").set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-PORK", qty: 4 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            });
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertSucceeds(
            adminDb.collection("central_kitchen_orders").doc("O4").update({
                status: "Confirmed",
            })
        );
    });

    test("Admin can UPDATE status from Requested -> Rejected", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().collection("central_kitchen_orders").doc("O5").set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-PRAWN", qty: 2 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            });
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertSucceeds(
            adminDb.collection("central_kitchen_orders").doc("O5").update({
                status: "Rejected",
            })
        );
    });

    test("Admin CANNOT change other fields (items/createdAt/etc.)", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().collection("central_kitchen_orders").doc("O6").set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-BEEF", qty: 1 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Requested",
            });
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertFails(
            adminDb.collection("central_kitchen_orders").doc("O6").update({
                items: [{ sku: "CK-BEEF", qty: 99 }], // not allowed per rules
            })
        );
    });

    test("Admin CANNOT transition from Confirmed -> Rejected (invalid transition)", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().collection("central_kitchen_orders").doc("O7").set({
                companyId: "NE001",
                storeId: "TP01",
                items: [{ sku: "CK-FISH", qty: 6 }],
                createdAt: new Date(),
                createdBy: "STF001",
                status: "Confirmed",
            });
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertFails(
            adminDb.collection("central_kitchen_orders").doc("O7").update({
                status: "Rejected",
            })
        );
    });
});
