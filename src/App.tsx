import { useState } from 'react';
import './App.css';
import ConnectForm from './components/ConnectForm';
import ServerView from './components/ServerView';

function App() {
  const [serverAddress, setServerAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  const handleDisconnect = () => {
    setIsConnected(false);
    setServerAddress('');
    // Ideally, tell backend to kill connection here too
  };

  if (isConnected) {
    return (
      <ServerView
        serverAddress={serverAddress}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return (
    <div className="container">
      <div className="bg-grid" />
      <ConnectForm
        onConnect={(address) => {
          setServerAddress(address);
          setIsConnected(true);
        }}
      />
    </div>
  );
}

export default App;
