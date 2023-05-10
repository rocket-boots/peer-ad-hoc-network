import { Peer } from 'peerjs';

import PeerAdHocNetwork from './src/PeerAdHocNetwork.js';

const pan = new PeerAdHocNetwork({ name: 'pan-test-net', Peer });
pan.connect();
window.pan = pan;
