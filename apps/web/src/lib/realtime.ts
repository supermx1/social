type Unsubscribe = () => void | Promise<void>;

type RealtimeCollection = {
	subscribe(topic: '*', callback: (event: unknown) => void): Promise<Unsubscribe>;
};

type RealtimeClient = {
	collection(name: string): RealtimeCollection;
};

export function subscribeToCollectionChanges(
	client: RealtimeClient,
	collections: string[],
	onChange: () => void | Promise<void>
) {
	const unsubscribers: Unsubscribe[] = [];
	let disposed = false;

	for (const collection of collections) {
		void client
			.collection(collection)
			.subscribe('*', () => {
				void onChange();
			})
			.then((unsubscribe) => {
				if (disposed) {
					void unsubscribe();
				} else {
					unsubscribers.push(unsubscribe);
				}
			})
			.catch(() => {
				// Keep the route usable if realtime setup fails; normal requests still work.
			});
	}

	return () => {
		disposed = true;
		for (const unsubscribe of unsubscribers.splice(0)) {
			void unsubscribe();
		}
	};
}
