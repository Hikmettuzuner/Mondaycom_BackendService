require('dotenv').config();  
const sql = require('mssql');
const axios = require('axios');

//#region Monday.com API URL ve headers AYARLARI
const API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = ;

const headers = {
  'Authorization': API_KEY,
  'Content-Type': 'application/json'
};
//#endregion

//#region VERİTABANI BAGLANTI AYARLARI
const config = {
  user: process.env.DB_USER,           // .env dosyasındaki DB_USER
  password: process.env.DB_PASSWORD,   // .env dosyasındaki DB_PASSWORD
  server: process.env.DB_SERVER,       // .env dosyasındaki DB_SERVER
  database: process.env.DB_NAME,       // .env dosyasındaki DB_NAME
  options: {
    encrypt: true,
    trustServerCertificate: true
  },
  requestTimeout: 60000 // 60 saniye
};

async function connectToDatabase() {
  try {
    await sql.connect(config);
    console.log('Veritabanına başarıyla bağlanıldı!');
  } catch (err) {
    console.error('Veritabanı bağlantısı hatası:', err);
  }
}

connectToDatabase();

async function getDataFromDatabase() {
  try {
    await sql.connect(config);
    const result = await sql.query(`
      SELECT TOP (3) *
      FROM SAP_Tables.dbo.MalzemeVMonday  ORDER BY MALZEME_KODU
    `);
    return result.recordset;
  } catch (err) {
    console.error("Veritabanı bağlantı hatası:", err.message, err.stack);
    throw err;
  }
}
//#endregion

//#region MONDAY.COM SÜTUN ID'LERİ

const COLUMN_IDS = {
  MALZEME_ADI: 'text_mkpvpe8r',
  STANDART_TANIM: 'text_mkqyt4a5',
  MAL_GRUBU: 'text_mkpv3d2x',
  HARICI_MAL_GRUBU: 'text_mkpvst42',
  TEMEL_OLCU_BIRIMI: 'color_mkpvaacs',
  NET_AGIRLIK: 'numeric_mkpv4yay',
  BRUT_AGIRLIK: 'numeric_mkpvc027',
  Son_Fatura_Tarihi_ForMonday: 'date_mkpvwj4m',
  SILME_DURUMU: 'color_mkqywq0b',
  SON_FATURA_NO:'text_mkqy4v4n'
};

//#endregion

//#region MONDAY.COM İŞLEMLERİ

const STATUS_OPTIONS = {
  TEMEL_OLCU_BIRIMI: { 'KG': 1, 'ADT': 2, 'M': 5 },
  SILME_DURUMU: { 'X': 2, '': 0 }
};

async function createItem(boardId, itemData) {
  const columnValues = {
    [COLUMN_IDS.MALZEME_ADI]: itemData.Malzeme_Adi,
    [COLUMN_IDS.MAL_GRUBU]: itemData.Mal_Grubu,
    [COLUMN_IDS.HARICI_MAL_GRUBU]: itemData.Harici_Mal_Grubu,
    [COLUMN_IDS.TEMEL_OLCU_BIRIMI]: {
      index: STATUS_OPTIONS.TEMEL_OLCU_BIRIMI[itemData.Temel_Olcu_Birimi]
    },
    [COLUMN_IDS.NET_AGIRLIK]: itemData.Net_Agırlık,
    [COLUMN_IDS.BRUT_AGIRLIK]: itemData.Brut_Agırlık,
    [COLUMN_IDS.Son_Fatura_Tarihi_ForMonday]: convertToISODate(itemData.Son_Fatura_Tarihi_ForMonday),
    [COLUMN_IDS.SON_FATURA_NO]: itemData.Son_Fatura_No,
    [COLUMN_IDS.STANDART_TANIM]: itemData.Standart_Tanim
  };

  const columnValuesStr = JSON.stringify(columnValues);

  function convertToISODate(tarihStr) {
    if (!tarihStr) return null;
  
    if (tarihStr.includes('.')) {
      const [gun, ay, yil] = tarihStr.split('.');
      return `${yil}-${ay}-${gun}`;
    } else if (tarihStr.includes('-')) {
      return tarihStr;
    }
    return null;
  }

  const query = `
    mutation {
      create_item(
        board_id: ${boardId},
        item_name: "${itemData.Malzeme_Kodu}",
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
//#endregion

//#region  ANA İŞLEM FONKSİYONU
async function main() {
  try {
    const dbData = await getDataFromDatabase();
    const promises = dbData.map(item => {
      const itemData = {
        Malzeme_Adi:  item.Malzeme_Adi,
        Malzeme_Kodu: item.Malzeme_Kodu,
        Mal_Grubu: item.Mal_Grubu,
        Harici_Mal_Grubu: item.Harici_Mal_Grubu,
        Temel_Olcu_Birimi: item.Temel_Olcu_Birimi,
        Net_Agırlık: item.Net_Agırlık,
        Brut_Agırlık: item.Brut_Agırlık,
        Son_Fatura_Tarihi_ForMonday: item.Son_Fatura_Tarihi_ForMonday,
        Son_Fatura_No:item.Son_Fatura_No,
        Silme_Isareti: item.Silme_Isareti,
        Standart_Tanim: item.Standart_Tanim
      };

      console.log("Veri gönderiliyor:", itemData);
      return createItem(BOARD_ID, itemData); // return promise
    });

    const results = await Promise.all(promises); // parallel requests
    results.forEach((result, i) => {
      if (result.errors) {
        console.error(`Hata [${i}]:`, JSON.stringify(result.errors, null, 2));
      } else {
        console.log(`Başarılı [${i}]:`, result.data);
      }
    });
  } catch (err) {
    console.error("Main Error:", err);
  }
}
//#endregion

main().catch(err => console.error("Main Error:", err));
