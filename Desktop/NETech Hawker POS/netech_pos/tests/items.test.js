// tests/items.test.js
const path = require("path");
const { readFileSync } = require("fs");
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require("@firebase/rules-unit-testing");

// Adjust if your emulator port differs
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8081;

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "demo-test-items",
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

// ---------- helpers ----------
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

function staffOtherStoreCtx() {
    return staffCtx({ storeId: "TP02", userId: "STF002" });
}

function adminCtx({ companyId = "NE001" } = {}) {
    return testEnv.authenticatedContext("admin-ne001", {
        role: "admin",
        companyId,
    });
}

function adminOtherCompanyCtx() {
    return testEnv.authenticatedContext("admin-ne002", {
        role: "admin",
        companyId: "NE002",
    });
}

// Seed an item with rules disabled
async function seedItem(id, data) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().collection("items").doc(id).set(data);
    });
}

describe("Items rules", () => {
    test("Staff can READ an item visible to their store", async () => {
        await seedItem("ITEM_VISIBLE", {
            companyId: "NE001",
            name: "Chicken Rice",
            price: 4.5,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP01", "TP03"],
        });

        const db = staffCtx({ storeId: "TP01" }).firestore();
        await assertSucceeds(db.collection("items").doc("ITEM_VISIBLE").get());
    });

    test("Staff CANNOT READ an item not visible to their store", async () => {
        await seedItem("ITEM_HIDDEN", {
            companyId: "NE001",
            name: "Duck Rice",
            price: 5.0,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP02"], // not TP01
        });

        const db = staffCtx({ storeId: "TP01" }).firestore();
        await assertFails(db.collection("items").doc("ITEM_HIDDEN").get());
    });

    test("Staff can LIST only items visible to their store (company-scoped)", async () => {
        // visible to TP01
        await seedItem("I1", {
            companyId: "NE001",
            name: "Noodles",
            price: 3.8,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP01"],
        });
        // hidden from TP01
        await seedItem("I2", {
            companyId: "NE001",
            name: "Porridge",
            price: 3.2,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP02"],
        });

        const db = staffCtx({ storeId: "TP01" }).firestore();
        // list without orderBy to avoid index noise in unit tests
        const snap = await db
            .collection("items")
            .where("companyId", "==", "NE001")
            .where("storeVisibility", "array-contains", "TP01")
            .get();

        expect(snap.docs.map((d) => d.id)).toContain("I1");
        expect(snap.docs.map((d) => d.id)).not.toContain("I2");
    });

    test("Staff CANNOT create/update/delete items", async () => {
        const staffDb = staffCtx().firestore();
        await assertFails(
            staffDb.collection("items").doc("NEW").set({
                companyId: "NE001",
                name: "New Item",
                price: 1.0,
                categoryId: "FOOD",
                isActive: true,
                storeVisibility: ["TP01"],
            })
        );

        await seedItem("EDIT_ME", {
            companyId: "NE001",
            name: "Editable",
            price: 2.0,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP01"],
        });

        await assertFails(
            staffDb.collection("items").doc("EDIT_ME").update({ price: 2.5 })
        );
        await assertFails(staffDb.collection("items").doc("EDIT_ME").delete());
    });

    test("Admin of SAME company can CREATE with required fields", async () => {
        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertSucceeds(
            adminDb.collection("items").doc("ADMIN_NEW").set({
                companyId: "NE001",
                name: "Admin Created",
                price: 6.0,
                categoryId: "FOOD",
                isActive: true,
                storeVisibility: ["TP01", "TP02"],
            })
        );
    });

    test("Admin can UPDATE fields but NOT change companyId", async () => {
        await seedItem("LOCK_COMPANY", {
            companyId: "NE001",
            name: "Locked Company",
            price: 7.0,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP01"],
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();

        // allowed updates
        await assertSucceeds(
            adminDb.collection("items").doc("LOCK_COMPANY").update({
                price: 7.5,
                isActive: false,
            })
        );

        // attempt to flip companyId -> denied
        await assertFails(
            adminDb.collection("items").doc("LOCK_COMPANY").update({
                companyId: "NE999",
            })
        );
    });

    test("Admin can DELETE item in their company; other company admin CANNOT READ", async () => {
        await seedItem("DEL_ME", {
            companyId: "NE001",
            name: "Delete Me",
            price: 1.5,
            categoryId: "FOOD",
            isActive: false,
            storeVisibility: ["TP01"],
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertSucceeds(adminDb.collection("items").doc("DEL_ME").delete());

        await seedItem("NE001_ONLY", {
            companyId: "NE001",
            name: "Company Item",
            price: 2.2,
            categoryId: "FOOD",
            isActive: true,
            storeVisibility: ["TP01"],
        });
        const otherAdminDb = adminOtherCompanyCtx().firestore();
        await assertFails(otherAdminDb.collection("items").doc("NE001_ONLY").get());
    });
});
