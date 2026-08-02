require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Используем новую актуальную библиотеку Google
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 8080; 

// БЕРЕМ КЛЮЧ ТОЛЬКО ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// Никаких ключей текстом в коде!
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Добавляем проверку: если ключа нет, сервер сразу скажет об этом в логах
if (!GEMINI_API_KEY) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: API ключ Gemini не найден!");
    console.error("Убедитесь, что прописали GEMINI_API_KEY в настройках Render.");
    // Не останавливаем сервер жестко, чтобы Render не ушел в вечный цикл перезагрузки, 
    // но запросы к ИИ будут падать с ошибкой, пока ключ не добавят.
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

app.get('/test', (req, res) => res.send('Сервер работает на актуальном API Gemini!'));

app.post('/api/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
        
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Сервер не настроен: отсутствует API ключ.' });
        }
        
        const filePath = req.file.path;
        
        // Подготавливаем файл для нового SDK
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
Если на фото курсовая или отчет - отказывай!
В этом случае верни строго: {"is_valid": false, "error_message": "Этот тип документа не поддерживается. Загрузите чек, гарантию или список."}

ШАГ 2: ЕСЛИ ДОКУМЕНТ ПОДХОДИТ (Чек, список, гарантия)
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
        
        // Запускаем анализ с использованием актуальной модели
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [prompt, imagePart],
            config: {
                // Принуждаем ИИ всегда возвращать чистый JSON
                responseMimeType: "application/json", 
                temperature: 0.0,
            }
        });

        const aiText = response.text;
        console.log("Получен ответ от ИИ");
            
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            console.error("Ошибка парсинга JSON от ИИ:", aiText);
            throw new Error("ИИ вернул неверный формат данных.");
        }
        
        // Сразу удаляем картинку, чтобы не засорять жесткий диск
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); 
        }
        
        if (parsedResponse.is_valid === false) {
            return res.status(400).json({ error: parsedResponse.error_message || "Документ не распознан." });
        }

        // Отправляем успешный результат на фронтенд
        res.json({ success: true, data: parsedResponse.data });
        
    } catch (error) {
        console.error('--- ОШИБКА СЕРВЕРА ---');
        console.error(error);
        
        // Гарантированно удаляем файл, если что-то сломалось
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Ошибка при обработке файла. Попробуйте еще раз.' });
    }
});

app.listen(PORT, () => console.log(`🚀 Умный сервер запущен на порту ${PORT}`));