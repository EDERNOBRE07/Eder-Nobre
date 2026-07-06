import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';

async function test() {
  const app = initializeApp({ projectId: firebaseConfig.projectId });
  
  // Test 1: Custom named database
  console.log("Test 1: Connecting to custom database:", firebaseConfig.firestoreDatabaseId);
  try {
    const dbCustom = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    const snapshot = await dbCustom.collection("records").limit(1).get();
    console.log("Test 1 SUCCESS! Records count:", snapshot.size);
  } catch (err: any) {
    console.error("Test 1 FAILED:", err.message || err);
  }

  // Test 2: Default database
  console.log("\nTest 2: Connecting to (default) database");
  try {
    const dbDefault = getFirestore(app);
    const snapshot = await dbDefault.collection("records").limit(1).get();
    console.log("Test 2 SUCCESS! Records count:", snapshot.size);
  } catch (err: any) {
    console.error("Test 2 FAILED:", err.message || err);
  }

  process.exit(0);
}

test();
