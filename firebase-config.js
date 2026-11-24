// Firebase config — take the real values from the Firebase Console and put them here.
// Firebase Console > Project Settings > Your apps > Web app — copy the
// firebaseConfig object from there and paste it over the "REPLACE_ME" values below.
// Until the config is added, the app shows a warning and does not
// save any attendance/salary data.

export const firebaseConfig = {
  apiKey: "AIzaSyAPtmN_cGHy5Hcc3--5Eq391hloEbZ-tQs",
  authDomain: "dokaan-haajiraa.firebaseapp.com",
  projectId: "dokaan-haajiraa",
  storageBucket: "dokaan-haajiraa.firebasestorage.app",
  messagingSenderId: "896306538242",
  appId: "1:896306538242:web:cc3ca63d8b3bcd0770841b"
};

// Whether the real config has been added
export const isFirebaseConfigured =
  !Object.values(firebaseConfig).some(v => v === "REPLACE_ME" || !v);
