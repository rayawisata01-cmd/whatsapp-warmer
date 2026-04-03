// WhatsApp Warmer Debug Script
// Run this in browser console BEFORE adding account

(function() {
  console.log('========================================');
  console.log('WhatsApp Warmer Debug Script v1.0');
  console.log('========================================');
  
  window.waDebug = {
    events: [],
    
    start: function() {
      var self = this;
      
      // Method 1: Try to find socket in window
      var socket = window.socketio || window.socket || window.io;
      
      if (socket && socket.onAny) {
        console.log('✅ Socket found, attaching listener...');
        
        socket.onAny(function(event) {
          var args = Array.prototype.slice.call(arguments, 1);
          var timestamp = new Date().toISOString();
          
          self.events.push({
            timestamp: timestamp,
            event: event,
            args: args
          });
          
          console.log('📩 [' + timestamp + '] EVENT: ' + event, args);
        });
        
        this.socket = socket;
        console.log('✅ Debug active! Socket ID:', socket.id);
        console.log('📋 Now add account, scan QR, then run: waDebug.report()');
        
      } else {
        console.log('⚠️ Socket not found directly. Trying alternative methods...');
        
        // Method 2: Hook into XHR
        var originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
          var xhr = new originalXHR();
          var originalOpen = xhr.open;
          
          xhr.open = function(method, url) {
            if (url && url.indexOf('socket.io') !== -1) {
              console.log('[XHR] Socket.io request:', method, url);
            }
            return originalOpen.apply(xhr, arguments);
          };
          
          return xhr;
        };
        
        // Method 3: Hook into fetch
        var originalFetch = window.fetch;
        window.fetch = function(url, options) {
          var urlStr = typeof url === 'string' ? url : url.toString();
          
          if (urlStr.indexOf('socket.io') !== -1 || urlStr.indexOf('/api/wa') !== -1) {
            console.log('[FETCH]', options?.method || 'GET', urlStr.substring(0, 100));
          }
          
          return originalFetch.apply(this, arguments).then(function(response) {
            if (urlStr.indexOf('socket.io') !== -1 || urlStr.indexOf('/api/wa') !== -1) {
              console.log('[FETCH RESPONSE]', response.status, urlStr.substring(0, 50));
            }
            return response;
          });
        };
        
        console.log('✅ Network hooks installed');
        console.log('📋 Now add account, scan QR, then run: waDebug.report()');
      }
    },
    
    report: function() {
      console.log('\n========== DEBUG REPORT ==========');
      console.log('Total events captured:', this.events.length);
      
      if (this.events.length > 0) {
        console.log('\nEvent Timeline:');
        this.events.forEach(function(e, i) {
          console.log((i + 1) + '. [' + e.event + ']', e.args);
        });
      } else {
        console.log('\n⚠️ No socket events captured');
        console.log('This means either:');
        console.log('1. Socket.io onAny is not available');
        console.log('2. No events were emitted from backend');
        console.log('3. Socket connection was lost');
      }
      
      console.log('\nRaw JSON:');
      console.log(JSON.stringify(this.events, null, 2));
      console.log('=================================\n');
      
      return this.events;
    },
    
    checkHealth: function() {
      console.log('\n========== HEALTH CHECK ==========');
      
      // Test Socket.io
      fetch('/socket.io/?EIO=4&transport=polling')
        .then(function(r) { return r.text(); })
        .then(function(t) { console.log('✅ Socket.io:', t.substring(0, 80)); })
        .catch(function(e) { console.error('❌ Socket.io failed:', e); });
      
      // Test API
      fetch('/api/wa/accounts')
        .then(function(r) { return r.json(); })
        .then(function(j) { console.log('✅ Accounts API:', j.length, 'accounts'); })
        .catch(function(e) { console.error('❌ Accounts API failed:', e); });
      
      // Test logs
      fetch('/api/wa/logs')
        .then(function(r) { return r.json(); })
        .then(function(j) { 
          console.log('✅ Logs API:', j.length, 'logs');
          // Show last 5 logs
          console.log('Last 5 logs:');
          j.slice(0, 5).forEach(function(log) {
            console.log('  -', log.type + ':', log.message.substring(0, 50));
          });
        })
        .catch(function(e) { console.error('❌ Logs API failed:', e); });
    },
    
    clear: function() {
      this.events = [];
      console.log('✅ Events cleared');
    }
  };
  
  // Auto-start
  window.waDebug.start();
})();
