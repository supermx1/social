import { config } from './pb';

export async function alertTelegram(message: string) {
	const token = config.TELEGRAM_BOT_TOKEN;
	const chatId = config.TELEGRAM_CHAT_ID;
	if (!token || !chatId) return;

	await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, text: message }),
	});
}
