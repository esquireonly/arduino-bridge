const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

module.exports = async function(plugin) {
    plugin.log('=== Arduino Bridge Plugin START ===');

    let port = null;
    let parser = null;
    let isConnected = false;
    let pollTimer = null;

    const channelValues = {
        R0: 0, R1: 0, R2: 0, R3: 0,
        W0: 0, W1: 0, W2: 0, W3: 0
    };

    try {
        const params = plugin.params.data || {};
        const portName = params.port || 'COM3';
        const baudRate = params.baudRate || 115200;
        const pollingInterval = params.pollingInterval || 1000;

        plugin.log(`Конфигурация: ${portName} @ ${baudRate} бод, опрос каждые ${pollingInterval}мс`);

        // ПОДКЛЮЧЕНИЕ К ARDUINO
        port = new SerialPort({
            path: portName,
            baudRate: baudRate,
            autoOpen: false
        });

        parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));


        plugin.log(`[Setting Interval]`);
        pollTimer = setInterval(pollArduino, pollingInterval);
        setTimeout(pollArduino, 1000);

        await new Promise((resolve, reject) => {
            plugin.log('[object Promise]');
            port.open((err) => {
                if (err) {
                    plugin.log(`❌ Ошибка открытия ${portName}: ${err.message}`, 'error');
                    reject(err);
                } else {
                    isConnected = true;
                    plugin.log(`✅ Подключено к ${portName}`);
                    resolve();
                }
            });
        });

        // ОБРАБОТКА ДАННЫХ ОТ ARDUINO
        parser.on('data', (line) => {
            const text = line.trim();
            if (!text) return;

            /*plugin.log(`Arduino << ${text}`);*/

            // Парсинг формата: "R0,R1,R2,R3,W0,W1,W2,W3"
            if (text.includes(',')) {
                const parts = text.split(',');

                if (parts.length === 8) {
                    const values = parts.map(v => {
                        const num = parseInt(v.trim());
                        return isNaN(num) ? 0 : num;
                    });

                    // Обновление локальных значений
                    channelValues.R0 = values[0];
                    channelValues.R1 = values[1];
                    channelValues.R2 = values[2];
                    channelValues.R3 = values[3];
                    /*channelValues.W0 = values[4];
                    channelValues.W1 = values[5];
                    channelValues.W2 = values[6];
                    channelValues.W3 = values[7];*/

                    // ОТПРАВКА В SCADA
                    sendToScada();
                } else {
                    plugin.log(`⚠️ Неверный формат: ${parts.length} значений (ожидается 8)`);
                }
            }
        });



        // ОБРАБОТКА ОШИБОК ПОРТА
        port.on('error', (err) => {
            plugin.log(`❌ Ошибка порта: ${err.message}`, 'error');
            plugin.sendLog({
                txt: `Ошибка COM-порта: ${err.message}`,
                level: 2
            });
            isConnected = false;
        });

        port.on('close', () => {
            plugin.log('⚠️ Порт закрыт');
            plugin.sendLog({
                txt: 'COM-порт закрыт',
                level: 1
            });
            isConnected = false;
        });

        // ЗАВЕРШЕНИЕ РАБОТЫ
        const cleanup = () => {
            plugin.log('🛑 Остановка плагина...');

            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }

            if (port && port.isOpen) {
                port.close((err) => {
                    if (err) {
                        plugin.log(`Ошибка закрытия порта: ${err.message}`, 'error');
                    } else {
                        plugin.log('Порт закрыт');
                    }
                });
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        if (plugin.on) {
            plugin.on('exit', cleanup);
        }

        plugin.sendLog('Arduino Bridge Plugin успешно запущен');
        // ФУНКЦИЯ ОТПРАВКИ ДАННЫХ В SCADA

        function sendToScada() {

            const ts = Date.now();

            const data = [
                { id: 'R0', value: channelValues.R0, ts, chstatus: 0 },
                { id: 'R1', value: channelValues.R1, ts, chstatus: 0 },
                { id: 'R2', value: channelValues.R2, ts, chstatus: 0 },
                { id: 'R3', value: channelValues.R3, ts, chstatus: 0 },
                { id: 'W0', value: channelValues.W0, ts, chstatus: 0 },
                { id: 'W1', value: channelValues.W1, ts, chstatus: 0 },
                { id: 'W2', value: channelValues.W2, ts, chstatus: 0 },
                { id: 'W3', value: channelValues.W3, ts, chstatus: 0 },
            ];

            plugin.sendData(data);

            // Логирование в журнал плагинов
            plugin.sendLog({
                txt: `Получены данные: R0=${channelValues.R0}, R1=${channelValues.R1}, R2=${channelValues.R2}, R3=${channelValues.R3}`,
                level: 0
            });
        }

        // АВТООПРОС ARDUINO
        async function pollArduino() {
            if (!isConnected || !port || !port.isOpen) return;

            try {
                plugin.onAct(message => {
                    plugin.log(message.data);
                });
                // Получить текущие значения W0-W3 из SCADA
                const channels = await plugin.channels.get();
                if (channels && Array.isArray(channels)) {
                    channels.forEach(ch => {
                        plugin.log(`Канал ${ch.id}  ${ch.value} ${ch.w}`);
                        if (ch.id && ch.id.startsWith('W') && ch.value !== undefined) {
                            channelValues[ch.id] = ch.value;
                        }
                    });
                }

                // Отправка GET в Arduino
                port.write('GET\n');
                /*plugin.log(`Arduino >> GET`);*/

                // Отправка значений W0-W3 в Arduino
                for (let i = 0; i < 4; i++) {
                    await sleep(50);
                    const cmd = `W${i}=${channelValues['W' + i]}\n`;
                    port.write(cmd);
                    /*plugin.log(`Arduino >> ${cmd.trim()}`);*/
                }

            } catch (err) {
                plugin.log(`Ошибка опроса: ${err.message}`, 'error');
                plugin.sendLog({
                    txt: `Ошибка опроса Arduino: ${err.message}`,
                    level: 2
                });
            }
        }

    } catch (err) {
        plugin.log(`КРИТИЧЕСКАЯ ОШИБКА: ${err.message}`, 'error');
        plugin.sendLog({
            txt: `Критическая ошибка: ${err.message}`,
            level: 2
        });
        plugin.exit(1, `Arduino plugin failed: ${err.message}`);
    }
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}