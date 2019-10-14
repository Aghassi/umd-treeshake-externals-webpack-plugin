import React from 'react';
import styled from 'styled-components';
import WelcomeC from './import_c.jsx';

const GoodbyeHeader = styled('<h1>Goodbye B</h1>');

class Goodbye extends React.Component {
    render() {
      return <GoodbyeHeader>
        <WelcomeC></WelcomeC>
      </GoodbyeHeader>;
    }
  }

export default Goodbye;