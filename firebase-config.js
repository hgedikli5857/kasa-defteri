// Firebase proje ayarların.
// Firebase konsolu → Proje ayarları → Genel → "Uygulamalarınız" → Web uygulaması → "SDK kurulumu ve yapılandırması"
// bölümündeki firebaseConfig değerlerini aşağıya yapıştır. Bu değerler gizli değildir; güvenliği Firestore kuralları sağlar.
// Değerler doldurulmazsa uygulama "deneme modunda" açılır (kayıtlar yalnızca bu cihazda tutulur).
export const firebaseConfig = {
  apiKey: "BURAYA_API_KEY",
  authDomain: "PROJE-ID.firebaseapp.com",
  projectId: "PROJE-ID",
  storageBucket: "PROJE-ID.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};
