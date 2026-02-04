require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = 1908914001;

const query = `
  query {
    boards(ids: ${BOARD_ID}) {
      items_page(limit: 50) {
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

async function fetchBoardData() {
  try {
    const response = await axios.post(
      'https://api.monday.com/v2',
      { query },
      {
        headers: {
          Authorization: API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const items = response.data.data.boards[0].items_page.items;

    const modelList = items.map(item => {
      const columnMap = {};
      item.column_values.forEach(col => {
        columnMap[col.id] = col.text;
      });

      return {
        id: item.id,
        malzemeAdi: columnMap['text_mkpvpe8r'] || '',
        standartTanim: columnMap['text_mkqyt4a5'] || '',
        malGrubu: columnMap['text_mkpv3d2x'] || '',
        hariciMalGrubu: columnMap['text_mkpvst42'] || '',
        temelOlcuBirimi: columnMap['color_mkpvaacs'] || '',
        netAgirlik: parseFloat(columnMap['numeric_mkpv4yay']) || 0,
        brutAgirlik: parseFloat(columnMap['numeric_mkpvc027']) || 0,
        sonFaturaTarihi: columnMap['date_mkpvwj4m'] || '',
        silmeDurumu: columnMap['color_mkqywq0b'] || '' ,
        sonFaturaNo: columnMap['text_mkqy4v4n'] || ''
      };
    });

    console.log("Model Listesi:");
    console.log(JSON.stringify(modelList, null, 2));

  } catch (error) {
    console.error("Hata:", error.response?.data || error.message);
  }
}

fetchBoardData();
