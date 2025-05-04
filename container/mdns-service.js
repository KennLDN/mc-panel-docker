const bonjour = require('bonjour')({ multicast: true, ttl: 255 }); // Import and initialize bonjour with options

let published = false;

function publishService(name, type, protocol, port) {
    const service = {
        name: name,
        type: type || 'minecraft-control', // Use provided type or default
        protocol: protocol || 'tcp',
        port: port,
    };

    console.log(`Advertising mDNS service: ${service.name} (${service.type}._${service.protocol}) on port ${service.port}`);
    bonjour.publish(service);
    published = true;
}

function unpublishService(callback) {
    if (published) {
        bonjour.unpublishAll(() => {
            console.log('mDNS service unpublished');
            bonjour.destroy(); // Clean up bonjour instance
            published = false;
            if (callback) callback();
        });
    } else {
        if (callback) callback();
    }

}

module.exports = { publishService, unpublishService }; 