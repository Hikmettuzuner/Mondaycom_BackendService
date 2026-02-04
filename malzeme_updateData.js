require('dotenv').config();
const axios = require('axios');

const API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = 1908914001;

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'API-Version': '2023-10' // Try adding an API version
};

const COLUMN_IDS = {
  MALZEME_ADI: 'text_mkpvpe8r',
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

// First find the item using the standard items query
async function getItemIdByMalzemeKodu(boardId, malzemeKodu) {
  const query = `
    query {
      boards(ids: ${boardId}) {
        items_page {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  try {
    console.log("Executing query to find item...");
    const response = await axios.post(API_URL, { query }, { headers });
    const result = response.data;

    if (result.errors) {
      console.error("GraphQL error:", result.errors);
      throw new Error("GraphQL query error");
    }

    if (!result.data || !result.data.boards || !result.data.boards[0]) {
      throw new Error("Invalid response format or board not found");
    }

    const items = result.data.boards[0].items_page.items;

    const targetItem = items.find(item => item.name === String(malzemeKodu));


    if (targetItem) {
      console.log(`Found item with ID: ${targetItem.id}`);
      return targetItem.id;
    } else {
      throw new Error(`Item not found with malzemeKodu: ${malzemeKodu}`);
    }
  } catch (error) {
    console.error("API Error:", error.response ? error.response.data : error.message);
    throw error;
  }
}


async function updateItemByMalzemeKodu(boardId, itemData) {
  try {
    const itemId = await getItemIdByMalzemeKodu(boardId, itemData.malzemeKodu);
    
    let columnValues = {};
    
    // Text Columns
    if (itemData.standartTanim !== null) columnValues[COLUMN_IDS.STANDART_TANIM] = String(itemData.standartTanim);
    if (itemData.Malzeme_Adi !== null) columnValues[COLUMN_IDS.MALZEME_ADI] = String(itemData.Malzeme_Adi);

    if (itemData.malGrubu !== null) columnValues[COLUMN_IDS.MAL_GRUBU] = String(itemData.malGrubu);
    if (itemData.hariciMalGrubu !== null) columnValues[COLUMN_IDS.HARICI_MAL_GRUBU] = String(itemData.hariciMalGrubu);
    if (itemData.SonFaturaNo !== null) columnValues[COLUMN_IDS.SON_FATURA_NO] = itemData.SonFaturaNo === "" ? "" : String(itemData.SonFaturaNo);

    // Status Columns
    if (itemData.temelOlcuBirimi !== null) {
      columnValues[COLUMN_IDS.TEMEL_OLCU_BIRIMI] = { 
        index: STATUS_OPTIONS.TEMEL_OLCU_BIRIMI[itemData.temelOlcuBirimi] 
      };
    }

    if (itemData.silmeDurumu !== null) {
      columnValues[COLUMN_IDS.SILME_DURUMU] = itemData.silmeDurumu === "X" 
        ? { index: STATUS_OPTIONS.SILME_DURUMU.X } 
        : null;
    }

    // Numeric Columns
    if (itemData.netAgirlik !== null) columnValues[COLUMN_IDS.NET_AGIRLIK] = String(itemData.netAgirlik);
    if (itemData.brutAgirlik !== null) columnValues[COLUMN_IDS.BRUT_AGIRLIK] = String(itemData.brutAgirlik);

    // Date Column
    if (itemData.sonFaturaTarihi !== null) {
      columnValues[COLUMN_IDS.SON_FATURA_TARIHI] = { date: itemData.sonFaturaTarihi };
    }

    const mutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${itemId},
          board_id: ${boardId},
          column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) {
          id
        }
      }
    `;

    const response = await axios.post(API_URL, { query: mutation }, { headers });
    const result = response.data;

    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    
    return result.data.change_multiple_column_values.id;
    
  } catch (error) {
    console.error("Update error:", error.message);
    throw error;
  }
}

// Define your status options
const STATUS_OPTIONS = {
  TEMEL_OLCU_BIRIMI: { 'KG': 1, 'ADT': 2, 'M': 5 },
  SILME_DURUMU: { 'X': 2, '': 0 } // Updated based on the error message
};


(async () => {
  try {
    console.log("Starting update process...");
    
    // Add a basic check for API_KEY
    if (!API_KEY || API_KEY === 'undefined') {
      throw new Error("API_KEY not found in environment variables");
    }
    
    await updateItemByMalzemeKodu(BOARD_ID, {
      Malzeme_Adi:"TEST DATA",
      malzemeKodu: "3000001",
      malGrubu: "Plastik",
      hariciMalGrubu: "Ambalaj",
      temelOlcuBirimi: "KG",
      netAgirlik: 125.5,
      brutAgirlik: 130.2,
      sonFaturaTarihi: "2025-04-18",
      silmeDurumu: "X",
      SonFaturaNo:"65456465",
      standartTanim:"TEST"
      });
    
    console.log("Process completed successfully");
  } catch (error) {
    console.error("Main process error:", error.message);
  }
})();