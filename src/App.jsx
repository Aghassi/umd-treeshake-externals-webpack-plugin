import b from './entry_b.jsx';

export default {
    a: import(/* webpackChunkName: 'a' */ './entry_a.jsx'),
    // b: import(/* webpackChunkName: 'b' */ './entry_b.jsx'),
    b
}