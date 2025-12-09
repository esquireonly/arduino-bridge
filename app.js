const { SerialPort } = require('serialport');

module.exports = async function(plugin) {
    plugin.log('=== Arduino Bridge Plugin ===');

    let port = null;
    let isConnected = false;
    const writeValues = [0, 0, 0, 0]; // W0-W3

    try {
        const params = plugin.params.data || {};
        const portName = params.port || 'COM3';
        const baudRate = params.baudRate || 115200;
        const pollingInterval = params.pollingInterval || 1000;

        plugin.log(`Подключение: ${portName}, ${baudRate} бод, интервал: ${pollingInterval}мс`);

        port = new SerialPort({
            path: portName,
            baudRate: baudRate,
            autoOpen: false
        });

        // Открытие порта
        await new Promise((resolve, reject) => {
            port.open((err) => {
                if (err) {
                    plugin.log(`Ошибка открытия порта: ${err.message}`, 'error');
                    reject(err);
                    return;
                }
                isConnected = true;
                plugin.log(`✅ Подключено к Arduino`);
                resolve();
            });
        });

        // Обработка входящих данных
        port.on('data', (data) => {
            const text = data.toString().trim();
            if (text) {
                plugin.log(`📨 Arduino: ${text}`);
                // Здесь можно парсить ответы
            }
        });

        port.on('error', (err) => {
            plugin.log(`Ошибка порта: ${err.message}`, 'error');
            isConnected = false;
        });

        port.on('close', () => {
            plugin.log('Порт закрыт');
            isConnected = false;
        });

        // Автоопрос Arduino
        async function pollArduino() {
            if (!isConnected) return;

            try {
                // 1. Запрос всех переменных
                port.write('GET\n');
                plugin.log('📤 Отправка: GET');

                // 2. Отправка переменных для записи
                for (let i = 0; i < 4; i++) {
                    const cmd = `W${i}=${writeValues[i]}\n`;
                    port.write(cmd);
                    plugin.log(`📤 Отправка: ${cmd.trim()}`);
                    await sleep(50); // Пауза между командами
                }
            } catch (err) {
                plugin.log(`Ошибка опроса: ${err.message}`, 'error');
            }
        }

        // Запуск периодического опроса
        const pollInterval = setInterval(pollArduino, pollingInterval);

        // Первый опрос
        setTimeout(pollArduino, 500);

        // Обработка команд от SCADA
        plugin.on('command', (cmd) => {
            plugin.log(`Получена команда: ${JSON.stringify(cmd)}`);

            if (cmd.type === 'write' && cmd.var && cmd.value !== undefined) {
                const match = cmd.var.match(/W(\d)/);
                if (match) {
                    const idx = parseInt(match[1]);
                    if (idx >= 0 && idx <= 3) {
                        writeValues[idx] = cmd.value;
                        plugin.log(`Установлено W${idx}=${cmd.value}`);
                    }
                }
            }
        });

        // Обработка завершения
        const cleanup = () => {
            clearInterval(pollInterval);
            if (port) {
                port.close();
                plugin.log('Соединение закрыто');
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        if (plugin.on) {
            plugin.on('exit', cleanup);
        }

    } catch (err) {
        plugin.log(`Ошибка инициализации: ${err.message}`, 'error');
        plugin.exit(1, `Arduino plugin failed: ${err.message}`);
    }
};

// Вспомогательная функция
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}