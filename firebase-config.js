// Firebase কনফিগ — আসল মানগুলো Firebase Console থেকে নিয়ে এখানে বসাতে হবে।
// Firebase Console > Project Settings > Your apps > Web app — সেখান থেকে
// firebaseConfig অবজেক্টটি কপি করে নিচের "REPLACE_ME" গুলোর জায়গায় বসান।
// কনফিগ না বসানো পর্যন্ত অ্যাপটি একটি সতর্কবার্তা দেখাবে এবং
// হাজিরা/বেতনের তথ্য সংরক্ষণ করবে না।

export const firebaseConfig = {
  apiKey: "AIzaSyAPtmN_cGHy5Hcc3--5Eq391hloEbZ-tQs",
  authDomain: "dokaan-haajiraa.firebaseapp.com",
  projectId: "dokaan-haajiraa",
  storageBucket: "dokaan-haajiraa.firebasestorage.app",
  messagingSenderId: "896306538242",
  appId: "1:896306538242:web:cc3ca63d8b3bcd0770841b"
};

// আসল কনফিগ বসানো হয়েছে কি না
export const isFirebaseConfigured =
  !Object.values(firebaseConfig).some(v => v === "REPLACE_ME" || !v);
