import React from 'react';
import styled from 'styled-components';

const GoodbyeHeader = styled('<h1>Goodbye B</h1>');

class Goodbye extends React.Component {
    render() {
      return <GoodbyeHeader></GoodbyeHeader>;
    }
  }

export default Goodbye;