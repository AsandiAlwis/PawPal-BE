const axios = require('axios');

async function testBackendPatch() {
    try {
        // Just to see if route exists. Note: need to bypass auth or pass a fake token to see a 401 instead of 404.
        const url = 'http://localhost:5000/api/vets/notifications/registration/test-id/read';
        console.log(`Patching ${url}`);
        const res = await axios.patch(url);
        console.log(res.status, res.data);
    } catch (err) {
        if (err.response) {
            console.log('Error status:', err.response.status);
            console.log('Error data:', err.response.data);
        } else {
            console.error(err.message);
        }
    }
}

testBackendPatch();
