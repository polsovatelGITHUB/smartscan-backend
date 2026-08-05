require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Используем НОВЕЙШУЮ библиотеку
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 8080; 

// БЕРЕМ КЛЮЧ ТОЛЬКО ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: GEMINI_API_KEY не найден в переменных окружения!");
    process.exit(1); 
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

app.use(cors());
app.use(express.json());

// Настраиваем папку для загрузок
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

app.get('/test', (req, res) => res.send('Сервер работает на актуальном API Gemini!'));

app.post('/api/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
        
        const filePath = req.file.path;
        
        const imagePart = {
            inlineData: {
                data: fs.readFileSync(filePath).toString("base64"),
                mimeType: req.file.mimetype
            }
        };
        
        const prompt = `ВНИМАНИЕ! ТЫ СТРОГИЙ МОДЕРАТОР И АНАЛИТИК ДОКУМЕНТОВ.

ШАГ 1: ПРОВЕРКА (КРИТИЧЕСКИ ВАЖНО)
Ты имеешь право обрабатывать ТОЛЬКО:
- Кассовые чеки
- Рукописные списки покупок или дел
- Гарантийные талоны
- Товарные накладные / счета

ЕСЛИ ТЫ ВИДИШЬ: Отчет (например, по курсовой работе), реферат, код, книгу, договор, людей, природу или любой другой документ, не являющийся списком покупок, чеком или гарантией, ТЫ ОБЯЗАН ОТКАЗАТЬ!
В этом случае верни строго: {"is_valid": false, "error_message": "Этот тип документа не поддерживается. Загрузите чек, гарантию или список."}

ШАГ 2: ЕСЛИ ДОКУМЕНТ ПОДХОДИТ
Создай массив колонок ("columns"), которые лучше всего описывают данные.
Для рукописного списка без цен - делай колонки "Наименование", "Кол-во", "Примечание", НО НИКАКИХ ЦЕН.

Верни ответ СТРОГО в формате JSON:
{
  "is_valid": true,
  "data": {
    "type": "Тип документа",
    "store": "Магазин (или 'Не указан')",
    "date": "Дата",
    "total": "Итого (или '-')",
    "columns": [
      {"key": "name", "label": "Название"},
      {"key": "qty", "label": "Кол-во"}
    ],
    "items": [
      {
        "name": "значение 1",
        "qty": "значение 2"
      }
    ]
  }
}`;

        console.log("Отправляем запрос к Gemini...");
        
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [prompt, imagePart],
            config: {
                responseMimeType: "application/json", 
                temperature: 0.0,
            }
        });

        const aiText = response.text;
            
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            throw new Error("ИИ вернул неверный формат данных.");
        }
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); 
        }
        
        if (parsedResponse.is_valid === false) {
            return res.status(400).json({ error: parsedResponse.error_message || "Документ не распознан." });
        }

        res.json({ success: true, data: parsedResponse.data });
        
    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Ошибка при обработке файла. Попробуйте еще раз.' });
    }
});

// ИСПРАВЛЕНИЕ: Теперь сервер и фронтенд лежат в одной папке!
app.use(express.static(__dirname)); 

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Умный сервер запущен на порту ${PORT}`));