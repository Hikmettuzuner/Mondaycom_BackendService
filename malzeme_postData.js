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
  NAME: 'subtasks_mkpvayqm',
  MALZEME_KODU: 'text_mkpvpe8r',
  STANDART_TANIM: 'text_mkqyt4a5',
  MAL_GRUBU: 'text_mkpv3d2x',
  HARICI_MAL_GRUBU: 'text_mkpvst42',
  TEMEL_OLCU_BIRIMI: 'color_mkpvaacs',
  NET_AGIRLIK: 'numeric_mkpv4yay',
  BRUT_AGIRLIK: 'numeric_mkpvc027',
  SON_FATURA_TARIHI: 'date_mkpvwj4m',
  SILME_DURUMU: 'color_mkqywq0b',
  SON_FATURA_NO:'text_mkqy4v4n'
};

const STATUS_OPTIONS = {
  TEMEL_OLCU_BIRIMI: { 'KG': 1, 'ADT': 2, 'M': 5 },
  SILME_DURUMU: { 'X': 2, '': 0 }
};

async function createItem(boardId, itemData) {
  const columnValues = {
    [COLUMN_IDS.MALZEME_KODU]: itemData.malzemeKodu,
    [COLUMN_IDS.MAL_GRUBU]: itemData.malGrubu,
    [COLUMN_IDS.HARICI_MAL_GRUBU]: itemData.hariciMalGrubu,
    [COLUMN_IDS.TEMEL_OLCU_BIRIMI]: {
      index: STATUS_OPTIONS.TEMEL_OLCU_BIRIMI[itemData.temelOlcuBirimi]
    },
    [COLUMN_IDS.NET_AGIRLIK]: itemData.netAgirlik,
    [COLUMN_IDS.BRUT_AGIRLIK]: itemData.brutAgirlik,
    [COLUMN_IDS.SON_FATURA_TARIHI]: {
      date: itemData.sonFaturaTarihi
    },
    [COLUMN_IDS.SON_FATURA_NO]: itemData.SonFaturaNo,
    [COLUMN_IDS.STANDART_TANIM]: itemData.standartTanim
  };
  
  if (
    itemData.silmeDurumu &&
    STATUS_OPTIONS.SILME_DURUMU[itemData.silmeDurumu] !== undefined
  ) {
    columnValues[COLUMN_IDS.SILME_DURUMU] = {
      index: STATUS_OPTIONS.SILME_DURUMU[itemData.silmeDurumu]
    };
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
    itemName: "ÜrünT_" + Math.floor(Math.random() * 1000),
    malzemeKodu: "MK-" + Math.floor(Math.random() * 100),
    malGrubu: "Plastik",
    hariciMalGrubu: "Ambalaj",
    temelOlcuBirimi: "KG",
    netAgirlik: 125.5,
    brutAgirlik: 130.2,
    sonFaturaTarihi: "2025-04-18",
    silmeDurumu: "X",
    SonFaturaNo:"",
    standartTanim:""
  };

  console.log("Veri gönderiliyor:", sampleData);
  const result = await createItem(BOARD_ID, sampleData);
  console.log("API Response:", JSON.stringify(result, null, 2));
}

main();


// Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

// Set-ExecutionPolicy Restricted -Scope CurrentUser

//npm install -g pkg

//pkg SQLDATApost.js --targets node18-win-x64

