// Gerekli modüllerin yüklenmesi
require('dotenv').config();
const sql = require('mssql');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const exceljs = require('exceljs');
const nodemailer = require('nodemailer');

// .env yükleme
try {
  if (fs.existsSync(path.join(process.cwd(), '.env'))) {
    require('dotenv').config({ path: path.join(process.cwd(), '.env') });
  } else if (fs.existsSync(path.join(__dirname, '.env'))) {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  } else {
    console.log('.env dosyası bulunamadı!');
  }
} catch (err) {
  console.error('.env yükleme hatası:', err);
}

//#region Monday.com API AYARLARI
const API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.MONDAY_API_KEY;
const MUSTERI_BOARD_ID = ; // MÜŞTERİ BOARD ID'NİZİ GÜNCELLEYİN

const headers = {
  'Authorization': API_KEY,
  'Content-Type': 'application/json'
};
//#endregion

//#region MÜŞTERİ KONFİGÜRASYONU
// Monday.com'daki sütun ID'leri
const MUSTERI_COLUMN_IDS = {
  NAME: 'name',
  YORUM: 'text4',
  MUSTERI_KODU: 'metin4',
  MUSTERI_ADI_YEDEK: 'metin3',
  SEHIR: 'metin17',
  ULKE_KODU: 'metin1',
  ULKE_ADI: "dup__of_metin",
  SEKTOR: "durum1",
  DAGITIM_KANAL: "durum2",
  SATIS_ORG: "durum",
  SILME_DURUMU : "color_mkt2p04q"
};

// Monday.com'daki dropdown/status seçenekleri
const MUSTERI_STATUS_OPTIONS = {
  SEKTOR_LIST: {
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
    "HAMUR": 13,
    "HURDA": 14
  },
  SATIS_ORG: {
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
  DAGITIM_KANAL_LIST: {
    "Üzerinde çalışılıyor": 0,
    "Bitir": 1,
    "Takılmış": 2,
    "10": 3,
    "20": 4,
    "": 5,
    "Distribution Channel": 6,
    "30": 7,
    "Dist. Channel": 8
  },
  SILME_DURUMU: { 'X': 2, '': 0 }
};
//#endregion

//#region VERİTABANI İŞLEMLERİ
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true
  },
  requestTimeout: 60000
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

async function updateSyncLogEnd(logId) {
  try {
    if (!sql.connected) await connectToDatabase();
    const request = new sql.Request();
    request.input('id', sql.Int, logId);
    await request.query(`
      UPDATE SAP_Tables.dbo.SyncMondayLog
      SET BitisTarihi = GETDATE() 
      WHERE ID = @id
    `);
    console.log(`Senkronizasyon log kaydı güncellendi. Log ID: ${logId}`);
  } catch (error) {
    console.error("Sync log bitirme hatası:", error);
  }
}

async function getMusteriDataFromDatabase() {
  try {
    await sql.connect(config);
    const result = await sql.query(`
      SELECT Top 10
        MusteriNo AS Musteri_Kodu,
        MusteriAdi AS Musteri_Adi,
        Il AS Sehir,
        UlkeKodu AS Ulke_Kodu,
        UlkeAdi AS Ulke_Adi,
        MusteriSektoru as Sektor,
        DagitimKanali AS Dagitim_Kanal,
        SatisOrg AS Satis_Org,
        SilmeIsareti AS Silme_Isareti
      FROM SAP_Tables.dbo.MusteriVMonday  
    `);
    return result.recordset;
  } catch (err) {
    console.error("Müşteri verisi çekme hatası:", err);
    throw err;
  }
}
//#endregion

//#region MONDAY.COM İŞLEMLERİ (MÜŞTERİ)
async function createMusteriItem(itemData) {
  const columnValues = {
    [MUSTERI_COLUMN_IDS.MUSTERI_ADI_YEDEK]: itemData.Musteri_Adi,
     [MUSTERI_COLUMN_IDS.MUSTERI_KODU]: itemData.Musteri_Kodu,
    [MUSTERI_COLUMN_IDS.SEHIR]: itemData.Sehir,
    [MUSTERI_COLUMN_IDS.ULKE_KODU]: itemData.Ulke_Kodu,
    [MUSTERI_COLUMN_IDS.ULKE_ADI]: itemData.Ulke_Adi,
    [MUSTERI_COLUMN_IDS.SEKTOR]: {
      index: MUSTERI_STATUS_OPTIONS.SEKTOR_LIST[itemData.Sektor] || 0
    },
    [MUSTERI_COLUMN_IDS.DAGITIM_KANAL]: {
      index: MUSTERI_STATUS_OPTIONS.DAGITIM_KANAL_LIST[itemData.Dagitim_Kanal] || 0
    },
    [MUSTERI_COLUMN_IDS.SATIS_ORG]: {
      index: MUSTERI_STATUS_OPTIONS.SATIS_ORG[itemData.Satis_Org] || 0
    },
    [MUSTERI_COLUMN_IDS.SILME_DURUMU]: itemData.Silme_Isareti ? { index: 2 } : null
  };

  const query = `
    mutation {
      create_item(
        board_id: ${MUSTERI_BOARD_ID},
        item_name: "${itemData.Musteri_Adi}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
      }
    }`;

  try {
    const response = await axios.post(API_URL, { query }, { headers });
    return response.data;
  } catch (error) {
    console.error('Müşteri oluşturma hatası:', error);
    throw error;
  }
}

// Güncelleme fonksiyonuna log ekleyelim
async function updateMusteriItem(itemId, itemData) {
  try {
    console.log(`[GÜNCELLEME] Müşteri güncelleniyor - ID: ${itemId}, Kod: ${itemData.Musteri_Kodu}`);
    
    const columnValues = {
      [MUSTERI_COLUMN_IDS.MUSTERI_ADI_YEDEK]: itemData.Musteri_Adi,
      [MUSTERI_COLUMN_IDS.SEHIR]: itemData.Sehir,
      [MUSTERI_COLUMN_IDS.ULKE_KODU]: itemData.Ulke_Kodu,
      [MUSTERI_COLUMN_IDS.ULKE_ADI]: itemData.Ulke_Adi,
      [MUSTERI_COLUMN_IDS.SEKTOR]: {
        index: MUSTERI_STATUS_OPTIONS.SEKTOR_LIST[itemData.Sektor] || 0
      },
      [MUSTERI_COLUMN_IDS.DAGITIM_KANAL]: {
        index: MUSTERI_STATUS_OPTIONS.DAGITIM_KANAL_LIST[itemData.Dagitim_Kanal] || 0
      },
      [MUSTERI_COLUMN_IDS.SATIS_ORG]: {
        index: MUSTERI_STATUS_OPTIONS.SATIS_ORG[itemData.Satis_Org] || 0
      },
      [MUSTERI_COLUMN_IDS.SILME_DURUMU]: itemData.Silme_Isareti ? { index: 2 } : null
    };

    console.log('[GÜNCELLEME] Yeni değerler:', JSON.stringify(columnValues, null, 2));

    const mutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${itemId},
          board_id: ${MUSTERI_BOARD_ID},
          column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) {
          id
        }
      }`;

    const response = await axios.post(API_URL, { query: mutation }, { headers });
    console.log('[GÜNCELLEME] Başarılı:', response.data);
    return response.data;
  } catch (error) {
    console.error("[GÜNCELLEME] Hata:", error.response?.data || error.message);
    throw error;
  }
}

async function getMusteriItemsFromMonday() {
  let allItems = [];
  let cursor = '';
  let hasNextPage = true;
  const limit = 500;

  while (hasNextPage) {
    const query = `
      query {
        boards(ids: ${MUSTERI_BOARD_ID}) {
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
            console.log(`Monday.com'dan ${cursor ? 'sonraki' : 'ilk'} ${limit} müşteri kaydı çekiliyor...`);

      const response = await axios.post(API_URL, { query }, { headers });
      const itemsPage = response.data.data.boards[0].items_page;
      const items = itemsPage.items;

      const modelList = items.map(item => {
        const columnMap = {};
        item.column_values.forEach(col => {
          try {
            columnMap[col.id] = col.value ? JSON.parse(col.value) : col.text;
          } catch {
            columnMap[col.id] = col.text;
          }
        });

        return {
          id: item.id,
          name: item.name,
          Musteri_Adi: columnMap[MUSTERI_COLUMN_IDS.MUSTERI_ADI_YEDEK] || '',
          Musteri_Kodu: columnMap[MUSTERI_COLUMN_IDS.MUSTERI_KODU] || '',
          Sehir: columnMap[MUSTERI_COLUMN_IDS.SEHIR] || '',
          Ulke_Kodu: columnMap[MUSTERI_COLUMN_IDS.ULKE_KODU] || '',
          Ulke_Adi: columnMap[MUSTERI_COLUMN_IDS.ULKE_ADI] || '',
          Sektor: columnMap[MUSTERI_COLUMN_IDS.SEKTOR] || '',
          Dagitim_Kanal: columnMap[MUSTERI_COLUMN_IDS.DAGITIM_KANAL] || '',
          Satis_Org: columnMap[MUSTERI_COLUMN_IDS.SATIS_ORG] || '',
          Silme_Isareti: columnMap[MUSTERI_COLUMN_IDS.SILME_DURUMU] ? 'X' : ''
        };
      });

      allItems = [...allItems, ...modelList];
      cursor = itemsPage.cursor;
      hasNextPage = !!cursor;

      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      if (error.response?.status === 429) {
        console.log("Rate limit aşıldı, 5 saniye bekleniyor...");
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        hasNextPage = false;
        console.error("Müşteri verisi çekme hatası:", error);
      }
    }
  }

  console.log(`Monday.com'dan toplam ${allItems.length} müşteri kaydı çekildi.`);
  return allItems;
}
//#endregion

//#region KARŞILAŞTIRMA FONKSİYONLARI (MÜŞTERİ)
function areMusteriValuesEqual(dbValue, mondayValue, key) {
  // Özel durum alanları için karşılaştırma
  if (key === 'Sektor') {
    const dbIndex = MUSTERI_STATUS_OPTIONS.SEKTOR_LIST[dbValue] ?? '';
    const mondayIndex = typeof mondayValue === 'object' ? mondayValue?.index ?? '' : mondayValue;
    return String(dbIndex) === String(mondayIndex);
  }

  if (key === 'Dagitim_Kanal') {
    const dbIndex = MUSTERI_STATUS_OPTIONS.DAGITIM_KANAL_LIST[dbValue] ?? '';
    const mondayIndex = typeof mondayValue === 'object' ? mondayValue?.index ?? '' : mondayValue;
    return String(dbIndex) === String(mondayIndex);
  }

  if (key === 'Satis_Org') {
    const dbIndex = MUSTERI_STATUS_OPTIONS.SATIS_ORG[dbValue] ?? '';
    const mondayIndex = typeof mondayValue === 'object' ? mondayValue?.index ?? '' : mondayValue;
    return String(dbIndex) === String(mondayIndex);
  }

  if (key === 'Silme_Isareti') {
    // DB'de 'X' veya boş geliyor, Monday'de ise {index: 2} veya null/undefined
    const dbStatus = dbValue === 'X' ? 'X' : '';
    const mondayStatus = (typeof mondayValue === 'object' && mondayValue?.index === 2) ? 'X' : '';
    return dbStatus === mondayStatus;
  }

  // Diğer alanlar için normal karşılaştırma
  const dbVal = String(dbValue || '').trim();
  const mondayVal = typeof mondayValue === 'object' ? String(mondayValue?.text || '').trim() : String(mondayValue || '').trim();
  return dbVal === mondayVal;
}

// Sadece bir tane compareMusteriItems fonksiyonu olmalı
function compareMusteriItems(dbItem, mItem) {
  const farkliAlanlar = [];
  
  const alanlar = [
    'Musteri_Adi', 'Sehir', 'Ulke_Kodu', 'Ulke_Adi', 
    'Sektor', 'Dagitim_Kanal', 'Satis_Org', 'Silme_Isareti'
  ];

  alanlar.forEach(alan => {
    if (!areMusteriValuesEqual(dbItem[alan], mItem[alan], alan)) {
      farkliAlanlar.push({
        alan,
        dbDegeri: dbItem[alan],
        mondayDegeri: mItem[alan]
      });
    }
  });

  return farkliAlanlar;
}
//#endregion

function compareMusteriItems(dbItem, mItem) {
  console.log(`[DEBUG] Karşılaştırma başladı - Müşteri Kodu: ${dbItem.Musteri_Kodu}`);
  
  const farkliAlanlar = [];
  
  const alanlar = [
    'Musteri_Adi', 'Sehir', 'Ulke_Kodu', 'Ulke_Adi', 
    'Sektor', 'Dagitim_Kanal', 'Satis_Org', 'Silme_Isareti'
  ];

  alanlar.forEach(alan => {
    const dbDeger = dbItem[alan];
    const mondayDeger = mItem[alan];
    
    if (!areMusteriValuesEqual(dbDeger, mondayDeger, alan)) {
      console.log(`[DEBUG] Fark bulundu - Alan: ${alan}`);
      farkliAlanlar.push({
        alan,
        dbDegeri: dbDeger,
        mondayDegeri: mondayDeger
      });
    }
  });

  console.log(`[DEBUG] Karşılaştırma tamamlandı - Farklı alan sayısı: ${farkliAlanlar.length}`);
  return farkliAlanlar;
}
//#endregion

function compareMusteriItems(dbItem, mItem) {
  const farkliAlanlar = [];
  
  const alanlar = [
    'Musteri_Adi', 'Sehir', 'Ulke_Kodu', 'Ulke_Adi', 
    'Sektor', 'Dagitim_Kanal', 'Satis_Org', 'Silme_Isareti'
  ];

  alanlar.forEach(alan => {
    if (!areMusteriValuesEqual(dbItem[alan], mItem[alan], alan)) {
      farkliAlanlar.push({
        alan,
        dbDegeri: dbItem[alan],
        mondayDegeri: mItem[alan]
      });
    }
  });

  return farkliAlanlar;
}
//#endregion

//#region ANA SENKRONİZASYON FONKSİYONU (MÜŞTERİ)
async function musteriSenkronizasyon() {
  try {
    console.log('Müşteri senkronizasyonu başlatılıyor...');
    await connectToDatabase();
    const logId = await insertSyncLogStart();
    
    // Verileri al
    const dbData = await getMusteriDataFromDatabase();
    const mondayItems = await getMusteriItemsFromMonday();
    
    console.log(`Veritabanından ${dbData.length} kayıt, Monday'den ${mondayItems.length} kayıt alındı.`);

   // Yeni öğeleri bulurken daha kesin karşılaştırma yapın
const newItems = dbData.filter(dbItem => 
  !mondayItems.some(mItem => 
    String(mItem.Musteri_Kodu).trim().toLowerCase() === 
    String(dbItem.Musteri_Kodu).trim().toLowerCase()
  )
);

    // 2. Güncellenecek müşteriler
    const updateList = [];
    const dbItemMap = new Map(dbData.map(item => [item.Musteri_Kodu, item]));

    mondayItems.forEach(mItem => {
      const dbItem = dbItemMap.get(mItem.Musteri_Kodu);
      if (!dbItem) return;

      const farkliAlanlar = compareMusteriItems(dbItem, mItem);
      if (farkliAlanlar.length > 0) {
        updateList.push({
          id: mItem.id,
          name: mItem.Musteri_Kodu,
          data: dbItem,
          farklar: farkliAlanlar
        });
      }
    });

    // Yeni öğeleri ekle
    console.log(`${newItems.length} yeni müşteri ekleniyor...`);
    for (const item of newItems) {
      await createMusteriItem(item);
      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit koruması
    }

    // Değişen öğeleri güncelle
    console.log(`${updateList.length} müşteri güncelleniyor...`);
    for (const item of updateList) {
      await updateMusteriItem(item.id, item.data);
      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit koruması
    }

    console.log(`Müşteri senkronizasyonu tamamlandı: ${newItems.length} yeni, ${updateList.length} güncellendi`);
    await updateSyncLogEnd(logId);

    // E-posta gönderme
    await sendEmailWithExcel(
      'test@gmail.com', // Alıcı e-posta adresleri
      `Mondaycom -> Müşteri Board Senkronizasyon Tamamlandı: ${new Date().toLocaleString()}`,
      'Müşteri senkronizasyonu tamamlandı',
      newItems,
      updateList.map(item => ({
        Musteri_Kodu: item.name,
        ...item.data,
        Farklar: item.farklar.map(f => `${f.alan}: ${f.dbDegeri} → ${f.mondayDegeri}`).join('; ')
      }))
    );

  } catch (err) {
    console.error("Müşteri senkronizasyon hatası:", err);
  }
}
//#endregion

//#region EXCEL VE E-POSTA FONKSİYONLARI
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

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (error) {
    console.error('Excel dosyası oluşturma hatası:', error);
    throw error;
  }
}

async function sendEmailWithExcel(to, subject, text, newItemsData, updateListData) {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.outlook.office365.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        ciphers: 'SSLv3'
      }
    });

    const attachments = [];

    if (newItemsData && newItemsData.length > 0) {
      const newItemsExcelBuffer = await createExcelFile(newItemsData);
      attachments.push({
        filename: 'yeni_musteriler.xlsx',
        content: newItemsExcelBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    }

    if (updateListData && updateListData.length > 0) {
      const updateListExcelBuffer = await createExcelFile(updateListData);
      attachments.push({
        filename: 'guncellenen_musteriler.xlsx',
        content: updateListExcelBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      text: text,
      attachments: attachments
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('E-posta gönderildi:', info.messageId);

  } catch (error) {
    console.error('E-posta gönderme hatası:', error);
  }
}
//#endregion

// Uygulamayı başlat
musteriSenkronizasyon().catch(err => {
  console.error("Müşteri senkronizasyon hatası:", err);
  process.exit(1);
});
