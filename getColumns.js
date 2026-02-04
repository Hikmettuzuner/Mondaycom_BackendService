require('dotenv').config();
const axios = require('axios');

const API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.MONDAY_API_KEY;

const headers = {
  'Authorization': API_KEY,
  'Content-Type': 'application/json'
};

async function getBoardColumns(boardId) {
  const query = `
    {
      boards(ids: [${boardId}]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;

  try {
    const response = await axios.post(API_URL, { query }, { headers });
    return response.data.data.boards[0].columns;
  } catch (error) {
    console.error('Error fetching columns:', error.response.data);
    return null;
  }
}

// Kullanım örneği
async function main() {
  //const boardId = 1908914001; // Malzeme Board ID
  const boardId = 1397412067; // Müşteri Board ID

  const columns = await getBoardColumns(boardId);
  
  console.log("Board Sütun Bilgileri:");
  columns.forEach(col => {
    console.log(`- ${col.title} (${col.type}): ${col.id}`);
  });
}

main();