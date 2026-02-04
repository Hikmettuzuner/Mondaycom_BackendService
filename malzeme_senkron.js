// Gerekli modüllerin yüklenmesi
require('dotenv').config(); // .env dosyasındaki çevresel değişkenleri yükle
const sql = require('mssql'); // SQL Server bağlantısı için
const axios = require('axios'); // HTTP istekleri için

const path = require('path');
const fs = require('fs');

const exceljs = require('exceljs'); // exceljs kütüphanesini ekledik
const nodemailer = require('nodemailer');

// .env dosyasını yüklemek için deneme
try { 
  // Önce mevcut dizindeki .env dosyasını kontrol et
  if (fs.existsSync(path.join(process.cwd(), '.env'))) {
    require('dotenv').config({ path: path.join(process.cwd(), '.env') });
    console.log('.env dosyası yüklendi - CWD');
  } 
  // Eğer bulamazsa, executable'ın bulunduğu dizindeki .env'yi kontrol et
  else if (fs.existsSync(path.join(__dirname, '.env'))) {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    console.log('.env dosyası yüklendi - DIRNAME');
  } 
  else {
    console.log('.env dosyası bulunamadı!');
  }
} catch (err) {
  console.error('.env yükleme hatası:', err);
}

//#region Monday.com API AYARLARI
const API_URL = 'https://api.monday.com/v2'; // Monday.com API endpoint
const API_KEY = process.env.MONDAY_API_KEY; // .env'den API anahtarı
const BOARD_ID = ; // Çalışılacak board ID

// API istekleri için headers ayarları
const headers = {
  'Authorization': API_KEY, // Yetkilendirme için API key
  'Content-Type': 'application/json' // JSON formatında veri gönderilecek
};
//#endregion

//#region YARDIMCI FONKSİYONLAR
/**
 * Tarih formatını GG.AA.YYYY'den YYYY-AA-GG'ye çevirir
 * @param {string} tarihStr - GG.AA.YYYY formatında tarih
 * @returns {string} ISO formatında tarih (YYYY-AA-GG)
 */
function convertToISODate(tarihStr) {
  if (!tarihStr) return null;
  
  if (tarihStr.includes('.')) {
    const [gun, ay, yil] = tarihStr.split('.');
    return `${yil}-${ay.padStart(2, '0')}-${gun.padStart(2, '0')}`;
  }
  return tarihStr; // Zaten ISO formatındaysa direkt dön
}
//#endregion

//#region VERİTABANI İŞLEMLERİ
// Veritabanı bağlantı ayarları
const config = {
  user: process.env.DB_USER,           // Veritabanı kullanıcı adı
  password: process.env.DB_PASSWORD,   // Veritabanı şifresi
  server: process.env.DB_SERVER,       // Sunucu adresi
  database: process.env.DB_NAME,       // Veritabanı adı
  options: {
    encrypt: true,                     // Şifreleme kullan
    trustServerCertificate: true       // Sertifikayı doğrula
  },
  requestTimeout: 60000                // 60 saniye timeout
};

/**
 * Veritabanına bağlantı kurar
 */
async function connectToDatabase() {
  try {
    await sql.connect(config);
    console.log('Veritabanına başarıyla bağlanıldı!');
  } catch (err) {
    console.error('Veritabanı bağlantısı hatası:', err);
  }
}

// Uygulama başlar başlamaz veritabanına bağlan
connectToDatabase();

/**
 * Veritabanından malzeme bilgilerini çeker
 * @returns {Promise<Array>} Malzeme listesi
 */
async function getDataFromDatabase() {
  try {
    await sql.connect(config); // Bağlantıyı kontrol et
    const result = await sql.query(`
      SELECT  * FROM SAP_Tables.dbo.MalzemeVMonday
    `);
    //WHERE [MALZEME_KODU] IN ('3016319','3016291','3019706','3015058')
    return result.recordset;
  } catch (err) {
    console.error("Veritabanı bağlantı hatası:", err.message, err.stack);
    throw err;
  }
}

// Kayıt başlat: başlangıç tarihini yaz ve ID'yi döndür
async function insertSyncLogStart() {
  try {
    const result = await sql.query(`
      INSERT INTO SAP_Tables.dbo.SyncMondayLog (BaslangicTarihi)
      OUTPUT INSERTED.ID
      VALUES (GETDATE())
    `);
    return result.recordset[0].ID;
  } catch (err) {
    console.error("Sync log başlatma hatası:", err.message);
    throw err;
  }
}

// Kayıt güncelle: bitiş tarihini yaz
async function updateSyncLogEnd(logId) {
  try {
    // Veritabanı bağlantısını kontrol et
    if (!sql.connected) {
      await connectToDatabase();
    }
    
    // Doğru şekilde parametreli sorgu kullanımı
    const request = new sql.Request();
    request.input('id', sql.Int, logId);
    
    const result = await request.query(`
      UPDATE SAP_Tables.dbo.SyncMondayLog
      SET BitisTarihi = GETDATE() 
      WHERE ID = @id
    `);
    
    console.log(`Senkronizasyon log kaydı güncellendi. Log ID: ${logId}`);
  } catch (error) {
    console.error("Sync log bitirme hatası:", error);
  }
}

//#endregion

//#region MONDAY.COM SABİTLERİ
// Monday.com'daki sütun ID'leri
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
  SON_FATURA_NO: 'text_mkqy4v4n'                 
};

// Monday.com'daki dropdown/status seçenekleri
const STATUS_OPTIONS = {
  TEMEL_OLCU_BIRIMI: { 'KG': 1, 'ADT': 2, 'M': 5 },
  SILME_DURUMU: { 'X': 2, '': 0 }
};

/**
 * Ölçü birimlerini standartlaştırır
 * @param {string} unit - Ölçü birimi
 * @returns {string} Standartlaştırılmış birim
 */
//#endregion

//#region MONDAY.COM İŞLEMLERİ
/**
 * Monday.com'da yeni öğe oluşturur
 * @param {number} boardId - Board ID
 * @param {object} itemData - Eklenecek öğe bilgileri
 * @returns {Promise<object>} API yanıtı
 */
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
    [COLUMN_IDS.STANDART_TANIM]: itemData.Standart_Tanim,
    [COLUMN_IDS.SILME_DURUMU]: itemData.Silme_Isareti ? { index: 2 } : null
    
  };

  const columnValuesStr = JSON.stringify(columnValues);

  // GraphQL mutation sorgusu
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
    //console.log(`Öğe oluşturuldu: ${itemName} (ID: ${response.data?.data?.create_item?.id})`);
    return response.data;
  } catch (error) {
    console.error('API Hatası:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Monday.com'da öğe günceller
 * @param {number} boardId - Board ID
 * @param {number} itemId - Güncellenecek öğe ID
 * @param {object} itemData - Yeni değerler
 * @returns {Promise<number>} Güncellenen öğe ID
 */
async function updateItem(boardId, itemId, itemData) {
  try {       
    // Güncellenecek sütun değerlerini hazırla
    let columnValues = {};
    
    // Değer null değilse güncelleme listesine ekle
    if (itemData.standartTanim !== null) columnValues[COLUMN_IDS.STANDART_TANIM] = String(itemData.standartTanim);
    if (itemData.malzemeAdi !== null) columnValues[COLUMN_IDS.MALZEME_ADI] = String(itemData.malzemeAdi);
    if (itemData.malGrubu !== null) columnValues[COLUMN_IDS.MAL_GRUBU] = String(itemData.malGrubu);
    if (itemData.hariciMalGrubu !== null) columnValues[COLUMN_IDS.HARICI_MAL_GRUBU] = String(itemData.hariciMalGrubu);
 
    // Dropdown/status sütunları için özel format
    if (itemData.temelOlcuBirimi !== null) {
      const index = STATUS_OPTIONS.TEMEL_OLCU_BIRIMI[itemData.temelOlcuBirimi];
      columnValues[COLUMN_IDS.TEMEL_OLCU_BIRIMI] = { index: index };
    }
 
    // Sayısal değerler
    if (itemData.netAgirlik !== null) columnValues[COLUMN_IDS.NET_AGIRLIK] = String(itemData.netAgirlik);
    if (itemData.brutAgirlik !== null) columnValues[COLUMN_IDS.BRUT_AGIRLIK] = String(itemData.brutAgirlik);
 
    // Tarih sütunu
    if (itemData.Son_Fatura_Tarihi_ForMonday === null) {
      columnValues[COLUMN_IDS.Son_Fatura_Tarihi_ForMonday] = {}; // Tarihi sil
    } else {
      columnValues[COLUMN_IDS.Son_Fatura_Tarihi_ForMonday] = { date: itemData.Son_Fatura_Tarihi_ForMonday };
    }

    if (itemData.sonFaturaNo  !== null) columnValues[COLUMN_IDS.SON_FATURA_NO] = String(itemData.sonFaturaNo );

    // Durum sütunu
    if (itemData.silmeDurumu !== null) {
      if (itemData.silmeDurumu === "X") {
        columnValues[COLUMN_IDS.SILME_DURUMU] = { index: 2 };
      } else if (itemData.silmeDurumu === "") {
        columnValues[COLUMN_IDS.SILME_DURUMU] = null; // Seçimi temizle
      } else {
        console.warn(`Uyarı: Geçersiz silmeDurumu değeri: ${itemData.silmeDurumu}`);
      }
    }
   
    // GraphQL mutation sorgusu
    const mutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${itemId},
          board_id: ${boardId},
          column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) {
          id
        }
      }`;
   
    const response = await axios.post(API_URL, { query: mutation }, { headers });
    const result = response.data;
   
    if (result.errors) {
      console.error("Güncelleme hatası:", result.errors);
      throw new Error("GraphQL mutation error");
    }
    
    console.log("Başarıyla güncellendi:", result.data.change_multiple_column_values.id);
    return result.data.change_multiple_column_values.id;
  } catch (error) {
    console.error("Güncelleme hatası:", error.response ? error.response.data : error.message);
    throw error;
  }
}
//#endregion

//#region ANA İŞLEM FONKSİYONU
/**
 * Veritabanı ve Monday.com arasında senkronizasyon sağlar
 */
async function main() {
  try {
    
    // Veritabanı bağlantısını garanti et
    await connectToDatabase();
    // En başta log başlat
    const logId = await insertSyncLogStart();
    // Verileri al
    const dbData = await getDataFromDatabase();
    const mondayItems = await getMondayItems();
    
    //console.log("=== DB VERİSİ ===");
    //console.dir(dbData, { depth: null });
    
    // console.log("=== MONDAY VERİSİ ===");
    // console.dir(mondayItems, { depth: null });

    // 1. DB'de olup Monday'de olmayanları bul
    // const newItems = dbData.filter(dbItem => 
    //   !mondayItems.some(mItem => mItem.name === dbItem.Malzeme_Kodu)
    // );


    const newItems = dbData.filter(dbItem => 
  !mondayItems.some(mItem => 
    String(mItem.name).trim().toLowerCase() === 
    String(dbItem.Malzeme_Kodu).trim().toLowerCase()
  )
);

  
    // 2. Monday'de olup DB'de de olanları kontrol et
    const updateList = [];
    const dbItemMap = new Map(dbData.map(item => [item.Malzeme_Kodu, item]));
  
    mondayItems.forEach(mItem => {
      const dbItem = dbItemMap.get(mItem.name);
      if (!dbItem) return; // DB'de yoksa atla
  
      // Verileri karşılaştırmak için formatla
      const dbItemData = {
        malzemeAdi: dbItem.Malzeme_Adi,
        standartTanim: dbItem.Standart_Tanim,
        malGrubu: dbItem.Mal_Grubu,
        hariciMalGrubu: dbItem.Harici_Mal_Grubu,
        temelOlcuBirimi: dbItem.Temel_Olcu_Birimi,
        netAgirlik: parseFloat(dbItem.Net_Agırlık),
        brutAgirlik: parseFloat(dbItem.Brut_Agırlık),
        Son_Fatura_Tarihi_ForMonday: convertToISODate(dbItem.Son_Fatura_Tarihi_ForMonday),
        silmeDurumu: dbItem.Silme_Isareti,
        sonFaturaNo:dbItem.Son_Fatura_No
      };
  
      const mondayItemData = {
        malzemeAdi: mItem.malzemeAdi,
        standartTanim: mItem.standartTanim,
        malGrubu: mItem.malGrubu,
        hariciMalGrubu: mItem.hariciMalGrubu,
        temelOlcuBirimi: mItem.temelOlcuBirimi?.label || mItem.temelOlcuBirimi,
        netAgirlik: parseFloat(mItem.netAgirlik),
        brutAgirlik: parseFloat(mItem.brutAgirlik),
        Son_Fatura_Tarihi_ForMonday: mItem.Son_Fatura_Tarihi_ForMonday.date,
        silmeDurumu: mItem.silmeDurumu?.label || mItem.silmeDurumu,
        sonFaturaNo:mItem.sonFaturaNo
      };

  
// Farklı alanları bul
const farkliAlanlar = [];

Object.keys(dbItemData).forEach(key => {
  const dbValue = dbItemData[key];
  const mondayValue = mondayItemData[key];

  if (!areEqual(dbValue, mondayValue, key)) {
    farkliAlanlar.push({
      alan: key,
      dbDegeri: dbValue,
      mondayDegeri: mondayValue
    });
  }
});

    
      if (farkliAlanlar.length > 0) {
        console.log(`Fark Bulundu: ${mItem.name}`, farkliAlanlar);
        updateList.push({ id: mItem.id, name: mItem.name, data: dbItemData ,data2:mondayItemData});
      }
    });

    // Yeni öğeleri ekle
    for (const item of newItems) {
      await createItem(BOARD_ID, item);
    }
  
    // Değişen öğeleri güncelle
    for (const item of updateList) {
      await updateItem(BOARD_ID, item.id, item.data);
      //console.log(`Güncellendi: ${item.name}`);
    }

       // Fark yoksa sonuç bildirimi
       if (newItems.length === 0 && updateList.length === 0) {
        console.log("Hiçbir fark bulunmadı. Veriler senkronize durumda.");
      } else {
        console.log(`Toplam ${newItems.length} yeni öğe eklendi, ${updateList.length} öğe güncellendi.`);
      }
  
    console.log("Senkronizasyon başarıyla tamamlandı!");
    await updateSyncLogEnd(logId);

    // E-posta gönderme
    await sendEmailWithExcel(
      'test@gmail.com', //
      `Mondaycom -> Malzeme Board Senkronizasyon Tamamlandı : ${new Date().toLocaleTimeString()}`, // E-posta konusu
      'Senkronizasyon tamamlandı..', // E-posta içeriği
      newItems, // Yeni eklenen öğeler için veri
      updateList // Güncellenen öğeler için veri
    );

  } catch (err) {
    console.error("Ana işlem hatası:", err);
  }
}

function areEqual(val1, val2, key = '') {
  const originalVal1 = val1;
  const originalVal2 = val2;

  // normalize et
  if (val1 === null || val1 === undefined || val1 === '') val1 = '';
  if (val2 === null || val2 === undefined || val2 === '') val2 = '';

  // Özel tip karşılaştırmaları
  if (key === 'temelOlcuBirimi') {
    const dbIndex = STATUS_OPTIONS.TEMEL_OLCU_BIRIMI[val1] ?? '';
    const mondayIndex = typeof val2 === 'object' && val2.index !== undefined ? val2.index : val2;
    const equal = dbIndex === mondayIndex;
    if (!equal) console.log(`Fark [${key}]: DB: ${val1} -> ${dbIndex}, MONDAY:`, val2);
    return equal;
  }

  if (key === 'silmeDurumu') {
    const dbIndex = STATUS_OPTIONS.SILME_DURUMU[val1] ?? '';
    const mondayIndex = typeof val2 === 'object' && val2.index !== undefined ? val2.index : STATUS_OPTIONS.SILME_DURUMU[val2] ?? '';
    const equal = dbIndex === mondayIndex;
    if (!equal) console.log(`Fark [${key}]: DB: ${val1} -> ${dbIndex}, MONDAY:`, val2);
    return equal;
  }

  // String karşılaştırması için trim işlemi uygula
  if (typeof val1 === 'string' && typeof val2 === 'string') {
    const trimmedVal1 = val1.trim();
    const trimmedVal2 = val2.trim();
    const equal = trimmedVal1 === trimmedVal2;
    
    if (!equal) {
      console.log(`Fark [${key}]: DB: ${originalVal1}, MONDAY: ${originalVal2}`);
      // Debug için ekstra bilgi göster
      if (trimmedVal1 === trimmedVal2) {
        console.log(`  Not: Boşluklar temizlendiğinde değerler aynı: "${trimmedVal1}"`);
      }
    }
    
    return equal;
  }

  // Tarih karşılaştırması - Eğer Son_Fatura_Tarihi_ForMonday alanı ise 
  if (key === 'Son_Fatura_Tarihi_ForMonday') {
    // Tarih formatı kontrolü ve karşılaştırma
    if (!val1 && !val2) return true;
    if (!val1 || !val2) return false;
    
    // Tarihleri normalize et ve karşılaştır
    try {
      const date1 = new Date(val1);
      const date2 = new Date(val2);
      const equal = !isNaN(date1.getTime()) && !isNaN(date2.getTime()) && 
                  date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0];
      
      if (!equal) console.log(`Fark [${key}]: DB: ${originalVal1}, MONDAY: ${originalVal2}`);
      return equal;
    } catch (e) {
      console.error(`Tarih karşılaştırma hatası: ${e.message}`);
      return false;
    }
  }

  // Varsayılan karşılaştırma (Sayı karşılaştırmaları dahil)
  const equal = String(val1) === String(val2);
  if (!equal) console.log(`Fark [${key}]: DB: ${originalVal1}, MONDAY: ${originalVal2}`);
  return equal;
}


//#endregion

//#region MONDAY.COM VERİ ÇEKME FONKSİYONU
/**
 * Monday.com'dan tüm öğeleri çeker
 * @returns {Promise<Array>} Öğe listesi
 */
/**
 * Monday.com'dan tüm öğeleri sayfalama (pagination) ile çeker
 * @returns {Promise<Array>} Öğe listesi
 */
async function getMondayItems() {
  let allItems = [];
  let cursor = '';
  let hasNextPage = true;
  const limit = 500; // Daha küçük bir limit kullanarak her seferinde daha az kayıt çek
  
  while (hasNextPage) {
    const query = `
      query {
        boards(ids: ${BOARD_ID}) {
          items_page(limit: ${limit}${cursor ? `, cursor: "${cursor}"` : ''}) {
            cursor
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
      }`;
    
    try {
      console.log(`Monday.com'dan ${cursor ? 'sonraki' : 'ilk'} ${limit} kayıt çekiliyor...`);
      
      const response = await axios.post(
        API_URL,
        { query },
        { headers }
      );
      
      const itemsPage = response.data.data.boards[0].items_page;
      const items = itemsPage.items;
      
      // Öğeleri işlenebilir formata çevir
      const modelList = items.map(item => {
        const columnMap = {};
        item.column_values.forEach(col => {
          columnMap[col.id] = col.value ? JSON.parse(col.value) : col.text;
        });
        
        return {
          id: item.id,
          name: item.name,
          malzemeAdi: columnMap[COLUMN_IDS.MALZEME_ADI] || '',
          standartTanim: columnMap[COLUMN_IDS.STANDART_TANIM] || '',
          malGrubu: columnMap[COLUMN_IDS.MAL_GRUBU] || '',
          hariciMalGrubu: columnMap[COLUMN_IDS.HARICI_MAL_GRUBU] || '',
          temelOlcuBirimi: columnMap[COLUMN_IDS.TEMEL_OLCU_BIRIMI] || '',
          netAgirlik: parseFloat(columnMap[COLUMN_IDS.NET_AGIRLIK]) || 0,
          brutAgirlik: parseFloat(columnMap[COLUMN_IDS.BRUT_AGIRLIK]) || 0,
          Son_Fatura_Tarihi_ForMonday: columnMap[COLUMN_IDS.Son_Fatura_Tarihi_ForMonday] || '',
          sonFaturaNo: columnMap[COLUMN_IDS.SON_FATURA_NO] || '',
          silmeDurumu: columnMap[COLUMN_IDS.SILME_DURUMU] || ''
        };
      });
      
      // Bulunan öğeleri ana listeye ekle
      allItems = [...allItems, ...modelList];
      
      // Cursor'u güncelle
      cursor = itemsPage.cursor;
      
      // Eğer cursor boş veya undefined ise, tüm verileri çektik demektir
      hasNextPage = !!cursor;
      
      console.log(`Toplam ${allItems.length} kayıt çekildi. Devam ediyor: ${hasNextPage}`);
      
      // API rate limit'i aşmamak için kısa bir bekleme ekleyelim
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 saniye bekle
      }
      
    } catch (error) {
      console.error("Monday.com veri çekme hatası:", error.response?.data || error.message);
      
      // Hata 429 (Too Many Requests) ise biraz daha uzun bekle ve tekrar dene
      if (error.response && error.response.status === 429) {
        console.log("Rate limit aşıldı, 5 saniye bekleniyor...");
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 saniye bekle
      } else {
        // Diğer hatalarda döngüyü sonlandır
        hasNextPage = false;
      }
    }
  }
  
  console.log(`Monday.com'dan toplam ${allItems.length} kayıt başarıyla çekildi.`);
  return allItems;
}
//#endregion


//#region EXCEL OLUŞTURMA FONKSİYONU
/**
 * Verileri Excel dosyasına yazar
 * @param {Array<object>} data - Yazılacak veri dizisi
 * @param {string} filePath - Dosya yolu
 * @returns {Promise<string>} Dosya yolu
 */
async function createExcelFile(data) {
  try {
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Veri');

    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      worksheet.addRow(headers);
    }

    data.forEach(item => {
      const row = Object.values(item);
      worksheet.addRow(row);
    });

    const buffer = await workbook.xlsx.writeBuffer(); // Bellekte oluştur
    return buffer;
  } catch (error) {
    console.error('Excel dosyası oluşturma hatası:', error);
    throw error;
  }
}
//#endregion

//#region E-POSTA GÖNDERME FONKSİYONU
/**
 * E-posta gönderir (Excel eki ile)
 * @param {string} to - Alıcı e-posta adresleri (virgülle ayrılmış)
 * @param {string} subject - E-posta konusu
 * @param {string} text - E-posta içeriği (düz metin)
 * @param {Array<object>} newItemsData - Yeni eklenen öğeler için veri
 * @param {Array<object>} updateListData - Güncellenen öğeler için veri
 * @returns {Promise<void>}
 */
async function sendEmailWithExcel(to, subject, text, newItemsData, updateListData) {
  try {
      // E-posta sunucu ayarları (Outlook Office 365 için)
      const transporter = nodemailer.createTransport({
          host: 'smtp.outlook.office365.com', // Outlook Office 365 sunucusu
          port: 587, // Genellikle 587 kullanılır (TLS)
          secure: false, // TLS kullanılıyorsa false, SSL kullanılıyorsa true (genellikle TLS)
          auth: {
              user: process.env.EMAIL_USER, // .env'den alın
              pass: process.env.EMAIL_PASS // .env'den alın
          },
          tls: {
              ciphers: 'SSLv3' // Bazı Office 365 sunucuları için gerekebilir
          }
      });

      const attachments = [];

      // Yeni öğeler varsa Excel ekle
      if (newItemsData && newItemsData.length > 0) {
          const newItemsExcelBuffer = await createExcelFile(newItemsData);
          attachments.push({
              filename: 'yeni_eklenenler.xlsx',
              content: newItemsExcelBuffer,
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
      }

      // Güncellenen öğeler varsa Excel ekle
      if (updateListData && updateListData.length > 0) {
            // Sadece 'data' nesnelerini içeren yeni bir dizi oluştur
            const updateListDataForExcel = updateListData.map(item => item.data);
            const updateListExcelBuffer = await createExcelFile(updateListDataForExcel);
            attachments.push({
                filename: 'guncellenenler.xlsx',
                content: updateListExcelBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
      }

      // E-posta seçenekleri
      const mailOptions = {
          from: process.env.EMAIL_USER,
          to: to,
          subject: subject,
          text: text,
          attachments: attachments // Sadece veri varsa ekler gönderilir
      };

      // E-posta gönder
      const info = await transporter.sendMail(mailOptions);
      console.log('E-posta gönderildi:', info.messageId);

  } catch (error) {
      console.error('E-posta gönderme hatası:', error);
  }
}
//#endregion



// Uygulamayı başlat
// main().catch(err => console.error("Uygulama hatası:", err));
main().catch(err => {
  console.error("Uygulama hatası:", err);
  console.log("Çıkış yapmak için bir tuşa basın...");
  // Konsolun kapanmaması için bekle
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', process.exit.bind(process, 0));
});
