require('dotenv').config();
const axios = require('axios');

const API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = ;

const headers = {
  'Authorization': API_KEY,
  'Content-Type': 'application/json'
};

let COLUMN_IDS = {
  NAME: 'name',
  YORUM: 'text4',
  MUSTERI_KODU: 'metin4',
  MUSTERI_ADI_YEDEK: 'metin3',
  SEHIR: 'metin17',
  ULKE_KODU: 'metin1',
  ULKE_ADI:"dup__of_metin",
  SEKTOR:"durum1",
  DAGITIM_KANAL:"durum2",
  SATIS_ORG:"durum"
};

const STATUS_OPTIONS = {
SEKTOR_LIST : {
  "BEYAZ EŞYA": 0,
  "ENDÜSTRIYEL": 1,
  "SAVUNMA": 2,
  "OTOMOTIV": 3,
  "ENERJI": 4,
  "": 5,
  "YAPI": 6,
  "ALTYAPI": 7,
  "ULAŞIM": 8,
  "Sector": 9,
  "SBIB": 10,
  "BEYAZESYA": 11,
  "ENDS": 12,
  "HAMUR": 13
},
SATIS_ORG : {
  "Üzerinde çalışılıyor": 0,
  "Bitir": 1,
  "Takılmış": 2,
  "1000": 3,
  "4000": 4,
  "": 5,
  "2000": 6,
  "Sales Organization": 7,
  "3000": 8,
  "6000": 9,
  "5000": 10
},
DAGITIM_KANAL_LIST : {
  "Üzerinde çalışılıyor": 0,
  "Bitir": 1,
  "Takılmış": 2,
  "10": 3,
  "20": 4,
  "": 5,
  "Distribution Channel": 6,
  "30": 7,
  "Dist. Channel": 8
}
,
  SILME_DURUMU: { 'X': 2, '': 0 }
};

// Sadece temel text sütunları için - status/dropdown değerleri gerekmez

async function createItem(boardId, itemData) {
  const columnValues = {};

  
  // Yorumlar
  if (itemData.yorum) {
    columnValues[COLUMN_IDS.YORUM] = itemData.yorum;
  }

    if (itemData.ulkeKodu) {
    columnValues[COLUMN_IDS.ULKE_KODU] = itemData.ulkeKodu;
  }

      if (itemData.sehir) {
    columnValues[COLUMN_IDS.SEHIR] = itemData.sehir;
  }

        if (itemData.musteriKodu) {
    columnValues[COLUMN_IDS.MUSTERI_KODU] = itemData.musteriKodu;
  }

          if (itemData.ulkeAdi) {
    columnValues[COLUMN_IDS.ULKE_ADI] = itemData.ulkeAdi;
  }

    // STATUS_OPTIONS – index kullanımı (temel ölçü birimi örneği mantığıyla)
  if (itemData.sektor && STATUS_OPTIONS.SEKTOR_LIST[itemData.sektor] !== undefined) {
    columnValues[COLUMN_IDS.SEKTOR] = { index: STATUS_OPTIONS.SEKTOR_LIST[itemData.sektor] };
  }

  if (itemData.satisOrg && STATUS_OPTIONS.SATIS_ORG[itemData.satisOrg] !== undefined) {
    columnValues[COLUMN_IDS.SATIS_ORG] = { index: STATUS_OPTIONS.SATIS_ORG[itemData.satisOrg] };
  }

  if (itemData.dagitimKanal && STATUS_OPTIONS.DAGITIM_KANAL_LIST[itemData.dagitimKanal] !== undefined) {
    columnValues[COLUMN_IDS.DAGITIM_KANAL] = { index: STATUS_OPTIONS.DAGITIM_KANAL_LIST[itemData.dagitimKanal] };
  }

  
  const columnValuesStr = JSON.stringify(columnValues);

  const query = `
    mutation {
      create_item(
        board_id: ${boardId},
        item_name: "${itemData.itemName}",
        column_values: ${JSON.stringify(columnValuesStr)}
      ) {
        id
      }
    }`;

  try {
    const response = await axios.post(API_URL, { query }, { headers });
    return response.data;
  } catch (error) {
    console.error('API Hatası:', error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  const sampleData = {
  itemName: "TESTVERİ URDA_" + Math.floor(Math.random() * 1000),
  yorum: "Test müşterisi - status ile",
  ulkeKodu: "14555",
  sehir: "İstanbul",
  musteriKodu: "TEST01",
  ulkeAdi: "Türkiye",
  sektor: "OTOMOTIV",                
  satisOrg: "1000",                    
  dagitimKanal: "20"    
  };

  console.log("Müşteri verisi gönderiliyor:", sampleData);
  
  try {
    const result = await createItem(BOARD_ID, sampleData);
    console.log("API Response:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Hata:", error);
  }
}

main();

// Kullanım talimatları:
// 1. npm install axios dotenv
// 2. .env dosyasında MONDAY_API_KEY tanımlayın
// 3. Sadece itemName, companyName ve comments alanları kullanılıyor

// Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
// Set-ExecutionPolicy Restricted -Scope CurrentUser
// npm install -g pkg
// pkg musteri_postData.js --targets node18-win-x64
