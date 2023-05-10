export default class PeerAdHocNetwork {
	constructor(options = {}) {
		const {
			// Settings
			name = 'pan-network',
			bannermen = 4,
			secret = 'Klaatu, Verata, Nikto',
			// Dependencies
			Peer,
		} = options;
		this.basePeerHandlers = {
			open: () => this.log('peer open'),
			connection: () => this.log('peer connection'),
			call: () => this.log('peer call'),
			close: () => this.log('peer close'),
			disconnected: () => this.log('peer disconnected'),
			error: (err) => this.warn('error', err),
		};
		this.baseConnectionHandlers = {
			error: (err) => this.warn('connection error', err),
			close: (conn) => this.log('connection close', conn.peer),
			data: (data, conn) => this.log('connection data', data, 'from', conn.peer),
			open: (conn) => this.log('connection open', conn.peer),
		};
		this.name = String(name);
		this.secret = String(secret);
		this.Peer = Peer;
		this.peer = null;
		this.connections = [];
		this.connectKnownPeerIndex = 0;
		this.authorizedPeers = [];
		// There should always be some peers in the network that are "broadcasting"
		// with known peer IDs. These are known as "bannerman". Their existence
		// allows someone new to the network - with no known peers - to join in.
		// The default is just to be named the same as the network, but there can
		// also be a number of others, ending in _0, _1, _2, etc.
		this.openBannermanPeerIndex = 0;
		const bannermanNumberArray = [];
		for (let i = 0; i < Number(bannermen); i += 1) { bannermanNumberArray.push(i); }
		this.bannermanPeerIds = [this.name].concat(
			bannermanNumberArray.map((n) => [this.name, n].join('_')),
		);
		// Maintain logs
		this.maxLogs = 100;
		this.logArray = [];
	}

	// ------------------------------------------------------------------------------------ Logging

	log(...args) {
		console.log(...args);
		this.logArray.push(['log', ...args]);
		if (this.logArray.length > 100) this.logArray.splice(0, 1);
	}

	warn(...args) {
		console.warn(...args);
		this.logArray.push(['warn', ...args]);
		if (this.logArray.length > 100) this.logArray.splice(0, 1);
	}

	// ------------------------------------------------------------------------------------ Save/Load

	getLocalStorageFullKey(key) { return `pan.${this.name}.${key}`; }

	save(key, value, type) {
		let saveValue = value;
		if (type === 'object') {
			saveValue = JSON.stringify(value);
		}
		window.localStorage.setItem(this.getLocalStorageFullKey(key), saveValue);
	}

	load(key, type) {
		const strVal = window.localStorage.getItem(this.getLocalStorageFullKey(key));
		if (type === 'object') {
			if (strVal === null) return {};
			return JSON.parse(strVal);
		}
		return strVal;
	}

	loadAuthorizedPeers() {
		this.authorizedPeers = this.load('authPeers', 'object');
		return this.authorizedPeers;
	}

	saveAuthorizedPeerId(peerId) {
		const peers = this.loadAuthorizedPeers();
		peers[peerId] = Number(new Date());
		this.save('authPeers', peers, 'object');
	}

	// -------------------------------------------------------- Generic Wrappers of Peer Connection

	setupConnectionHandlers(conn, handlerOverrides = {}) {
		const handlers = {
			...this.baseConnectionHandlers,
			...handlerOverrides,
		};
		conn.on('error', (err) => handlers.error(err));
		conn.on('close', () => handlers.close(conn));
		conn.on('data', (data) => handlers.data(data, conn));
		conn.on('open', () => handlers.open(conn));
	}

	connectTo(peerId = undefined, handlerOverrides = {}, metadata = undefined) {
		this.log('Attempting to connect to', peerId);
		if (!this.peer) {
			this.warn('No peer - cannot connect');
			return;
		}
		const connectionOptions = {};
		if (metadata) connectionOptions.metadata = metadata;
		const conn = this.peer.connect(peerId, connectionOptions);
		this.setupConnectionHandlers(conn, handlerOverrides);
	}

	// ------------------------------------------------------------------------------------ Handlers

	handlePeerData(data, conn) {
		this.log('Received', data, 'from', conn.peer);
	}

	verifyConnection(connection) {
		const { networkName, secret } = connection.metadata;
		if (networkName !== this.name) return false;
		if (secret !== this.secret) return false;
		return true;
	}

	handleConnectionData(data, conn) {
		if (data.request) {
			this.log('Data request incoming:', data.request);
			if (data.request === 'peers') {
				conn.send({ response: { peers: this.loadAuthorizedPeers() } });
			}
		} else if (data.response) {
			this.log('Data response incoming:', data.response);
			// TODO: If receiving peers, then add them to the list
		} else {
			this.log('Data incoming:', data);
		}
	}

	handleConnectionOpen(connection) {
		const { peer } = connection;
		// We need to wait until its open before it is really usable
		this.saveAuthorizedPeerId(peer);
		connection.send({ request: 'peers' });
	}

	handlePeerConnection(connection) {
		const { peer } = connection;
		this.log('Connection made to', peer);
		if (!this.verifyConnection(connection)) {
			this.warn('Bad connection from a peer not verified to be in the network. Disconnecting.');
			connection.close();
			return;
		}
		this.setupConnectionHandlers(connection, this.getConnectionHandlers());
	}

	handleOpenPeer(peerId) {
		this.log('Opened as', peerId);
		this.save('peerId', peerId);
	}

	getConnectionHandlers() {
		return {
			data: (data, conn) => this.handleConnectionData(data, conn),
			open: (conn) => this.handleConnectionOpen(conn),
		};
	}

	// ------------------------------------------------------------------------------------ Connection

	connectNext() {
		this.connectKnownPeerIndex += 1;
		this.connectToKnownPeer();
	}

	getKnownPeers() {
		return [
			...Object.keys(this.loadAuthorizedPeers()),
			...this.bannermanPeerIds,
		];
	}

	connectToKnownPeer() {
		const toPeerId = this.getKnownPeers()[this.connectKnownPeerIndex];
		if (!toPeerId) {
			// Assume all peers are offline. Stop trying to connect, and just start the network anew
			this.openAsBannerman();
			return;
		}
		const metadata = {
			networkName: this.name,
			secret: this.secret,
		};
		this.connectTo(toPeerId, this.getConnectionHandlers(), metadata);
	}

	openPeer(peerId = undefined, handlerOverrides = {}) {
		if (this.peer) this.peer.destroy();
		this.log('Attempting to open as', peerId);
		const peer = new this.Peer(peerId);
		const handlers = {
			...this.basePeerHandlers,
			...handlerOverrides,
		};
		peer.on('open', () => handlers.open(peer));
		peer.on('connection', (connection) => handlers.connection(connection));
		peer.on('call', () => handlers.call());
		peer.on('close', () => handlers.close());
		peer.on('disconnected', () => handlers.disconnected());
		peer.on('error', (err) => handlers.error(err));
		this.peer = peer;
	}

	/** Open a new peer and try to connect to peers on the network */
	connect(fromPeerIdParam = undefined) {
		const savedPeerId = this.load('peerId');
		const fromPeerId = (!fromPeerIdParam && savedPeerId) ? savedPeerId : fromPeerIdParam;
		const handlers = {
			open: (peer) => this.handleOpenPeer(peer.id),
			connection: (connection) => this.handlePeerConnection(connection),
			error: (err) => {
				if (err.type === 'peer-unavailable') {
					this.connectNext();
					return;
				}
				this.warn('error', err.type);
			},
		};
		this.openPeer(fromPeerId, handlers);
		this.connectToKnownPeer();
	}

	openAsBannerman() {
		if (this.peer) this.peer.destroy();
		const peerId = this.bannermanPeerIds[this.openBannermanPeerIndex];
		const handlers = {
			// open -- do nothing special -- we don't want to save bannermen peer IDs
			connection: (connection) => this.handlePeerConnection(connection),
			error: (err) => {
				if (err.type === 'peer-unavailable') {
					// this.connectNext();
					// TODO: Open as next
					return;
				}
				this.warn('peer error', err.type, err);
			},
		};
		this.openPeer(peerId, handlers);
	}
}
