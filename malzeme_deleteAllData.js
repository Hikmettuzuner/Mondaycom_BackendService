require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = 1908914001;

const headers = {
  'Authorization': API_KEY,
  'Content-Type': 'application/json'
};

async function getAllItemIds() {
  const query = `
    {
      boards(ids: [${BOARD_ID}]) {
        items_page {
          items {
            id
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post('https://api.monday.com/v2', { query }, { headers });
    return response.data.data.boards[0].items_page.items.map(item => item.id);
  } catch (error) {
    console.error('Öğe ID\'leri alınamadı:', error.response?.data || error.message);
    throw error;
  }
}

async function deleteItem(itemId) {
  const query = `
    mutation {
      delete_item(item_id: ${itemId}) {
        id
      }
    }
  `;

  try {
    await axios.post('https://api.monday.com/v2', { query }, { headers });
  } catch (error) {
    console.error(`Öğe silinemedi (ID: ${itemId}):`, error.response?.data || error.message);
    throw error;
  }
}

async function deleteAllItems() {
  try {
    console.log(`Board ID: ${BOARD_ID} için öğeler alınıyor...`);
    const itemIds = await getAllItemIds();

    if (!itemIds || itemIds.length === 0) {
      console.log("⚠️ Board zaten boş.");
      return;
    }

    console.log(`🗑️ Toplam ${itemIds.length} öğe silinecek...`);

    // Rate limit için 500ms bekleme ile
    for (const [index, id] of itemIds.entries()) {
      try {
        await deleteItem(id);
        console.log(`✅ [${index + 1}/${itemIds.length}] Silindi: ${id}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit koruması
      } catch (error) {
        console.log(`❌ [${index + 1}/${itemIds.length}] Silinemedi: ${id}`);
      }
    }

    console.log("✨ Tüm silme işlemi tamamlandı.");

  } catch (error) {
    console.error("⛔ Kritik hata:", error.message);
  }
}

// İşlemi başlat
deleteAllItems();