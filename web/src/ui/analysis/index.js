/**
 * Registering is a side effect of importing, so this module is the list.
 * Order here is the order they appear.
 */
import './reach.jsx';
import './contains.jsx';
import './gaps.jsx';
import './byHand.jsx';
import './overRepresented.jsx';

export { analyse, all, register } from './registry.js';
