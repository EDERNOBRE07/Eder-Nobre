import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

// Custom Google Auth Provider with Google Drive scopes for file imports
export const googleDriveProvider = new GoogleAuthProvider();
googleDriveProvider.addScope("https://www.googleapis.com/auth/drive.readonly");
googleDriveProvider.addScope("https://www.googleapis.com/auth/drive.metadata.readonly");

