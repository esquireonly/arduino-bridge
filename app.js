const { SerialPort } = require('serialport');

module.exports = async function(plugin) {
    plugin.log('=== Arduino Bridge Plugin ===');

    let port = null;
    let isConnected = false;

    try {
        const params = plugin.params.data || {};
        const portName = params.port || 'COM3';
        const baudRate = params.baudRate || 115200;
        const pollingInterval = params.pollingInterval || 1000;

        plugin.log(`Подключение: ${portName}, ${baudRate} бод, интервал: ${pollingInterval}мс`);

        // 1. СОЗДАНИЕ КАНАЛОВ
        async function createChannels() {
            try {
                plugin.log('Проверка каналов...');
                const channels = await plugin.channels.get();

                if (!channels || channels.length === 0) {
                    plugin.log('Каналы отсутствуют, создаю...');

                    const newChannels = [
                        { id: 'R0', chan: 'R0', r: 1, w: 0, desc: 'Чтение 0' },
                        { id: 'R1', chan: 'R1', r: 1, w: 0, desc: 'Чтение 1' },
                        { id: 'R2', chan: 'R2', r: 1, w: 0, desc: 'Чтение 2' },
                        { id: 'R3', chan: 'R3', r: 1, w: 0, desc: 'Чтение 3' },
                        { id: 'W0', chan: 'W0', r: 0, w: 1, desc: 'Запись 0' },
                        { id: 'W1', chan: 'W1', r: 0, w: 1, desc: 'Запись 1' },
                        { id: 'W2', chan: 'W2', r: 0, w: 1, desc: 'Запись 2' },
                        { id: 'W3', chan: 'W3', r: 0, w: 1, desc: 'Запись 3' }
                    ];

                    plugin.send({
                        type: 'channels',
                        op: 'add',
                        data: newChannels
                    });

                    plugin.log(`✅ Создано ${newChannels.length} каналов`);
                } else {
                    plugin.log(`✓ Каналы уже существуют: ${channels.length} шт`);
                    // Лог первых 4 каналов для проверки
                    channels.slice(0, 4).forEach(ch => {
                        plugin.log(`  - ${ch.id}: r=${ch.r}, w=${ch.w}, value=${ch.value}`);
                    });
                }
            } catch (err) {
                plugin.log(`❌ Ошибка создания каналов: ${err.message}`, 'error');
            }
        }

        await createChannels();

        // 2. ПОДКЛЮЧЕНИЕ К ARDUINO
        port = new SerialPort({
            path: portName,
            baudRate: baudRate,
            autoOpen: false
        });

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

        // 3. ОБРАБОТКА ДАННЫХ ОТ ARDUINO С ДИАГНОСТИКОЙ
        port.on('data', (data) => {
            const text = data.toString().trim();
            if (text) {
                plugin.log(`📨 Arduino RAW: "${text}"`);

                // Парсинг ответа
                if (text.includes(',')) {
                    const values = text.split(',').map(v => {
                        const parsed = parseInt(v.trim());
                        return isNaN(parsed) ? 0 : parsed;
                    });

                    plugin.log(`🔢 Парсинг: [${values.join(', ')}] (${values.length} значений)`);

                    if (values.length === 8) {
                        // ДИАГНОСТИКА: что отправляем
                        plugin.log(`🚀 Отправка в SCADA:`);
                        plugin.log(`   R0 = ${values[0]}`);
                        plugin.log(`   R1 = ${values[1]}`);
                        plugin.log(`   R2 = ${values[2]}`);
                        plugin.log(`   R3 = ${values[3]}`);

                        // Отправка данных в SCADA
                        try {
                            plugin.sendData([
                                { id: 'R0', value: values[0], ts: Date.now(), chstatus: 0 },
                                { id: 'R1', value: values[1], ts: Date.now(), chstatus: 0 },
                                { id: 'R2', value: values[2], ts: Date.now(), chstatus: 0 },
                                { id: 'R3', value: values[3], ts: Date.now(), chstatus: 0 }
                            ]);
                            plugin.log(`✅ sendData() вызван для R0-R3`);
                        } catch (err) {
                            plugin.log(`❌ Ошибка sendData: ${err.message}`, 'error');
                        }
                    } else {
                        plugin.log(`⚠️ Неверное количество значений: ${values.length} (ожидается 8)`);
                    }
                } else {
                    plugin.log(`📝 Текстовый ответ: ${text}`);
                }
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

        // 4. АВТООПРОС ARDUINO
        async function pollArduino() {
            if (!isConnected) return;

            try {
                // Запрос значений W0-W3 у SCADA
                const channels = await plugin.channels.get();
                const writeValues = { W0: 0, W1: 0, W2: 0, W3: 0 };

                if (channels && Array.isArray(channels)) {
                    channels.forEach(ch => {
                        if (ch.id && ch.id.startsWith('W') && ch.value !== undefined) {
                            writeValues[ch.id] = ch.value;
                        }
                    });
                }

                // Отправка команд в Arduino
                port.write('GET\n');
                plugin.log('📤 Отправка: GET');

                for (let i = 0; i < 4; i++) {
                    const cmd = `W${i}=${writeValues[`W${i}`]}\n`;
                    port.write(cmd);
                    plugin.log(`📤 Отправка: ${cmd.trim()}`);
                    await sleep(50);
                }

            } catch (err) {
                plugin.log(`Ошибка опроса: ${err.message}`, 'error');
            }
        }

        // Запуск периодического опроса
        const pollInterval = setInterval(pollArduino, pollingInterval);

        // Первый опрос
        setTimeout(pollArduino, 500);

        // 5. ТЕСТОВАЯ ФУНКЦИЯ
        async function testSendManual() {
            plugin.log('🔧 ТЕСТ: Ручная отправка данных');

            const testData = [
                { id: 'R0', value: 100, ts: Date.now(), chstatus: 0 },
                { id: 'R1', value: 200, ts: Date.now(), chstatus: 0 },
                { id: 'R2', value: 300, ts: Date.now(), chstatus: 0 },
                { id: 'R3', value: 400, ts: Date.now(), chstatus: 0 }
            ];

            try {
                plugin.sendData(testData);
                plugin.log('✅ Тестовые данные отправлены');
            } catch (err) {
                plugin.log(`❌ Ошибка теста: ${err.message}`, 'error');
            }
        }

        // 6. ОБРАБОТКА КОМАНД
        plugin.on('command', (cmd) => {
            plugin.log(`Получена команда: ${JSON.stringify(cmd)}`);

            if (cmd === 'test') {
                testSendManual();
            }
        });

        // 7. ЗАВЕРШЕНИЕ РАБОТЫ
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