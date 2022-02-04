const WebSocket = require("ws");
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

//Include Google Speech to Text
const speech = require("@google-cloud/speech");
const { StreamDescriptor } = require("google-gax");
const client = new speech.SpeechClient();

//Include Twilio client 
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilio_client = require("twilio")(accountSid, authToken);

//Include OpainAI
const OpenAI = require('openai-api');

// Load your key from an environment variable or secret management service
// (do not include your key directly in your code)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI(OPENAI_API_KEY);
//Get Googel credentials: https://cloud.google.com/docs/authentication/getting-started
// Link to tutorial for setting things up: https://www.twilio.com/blog/live-transcribing-phone-calls-using-twilio-media-streams-and-google-speech-text
//For multiple calls to the same number: https://www.twilio.com/blog/multiple-twilio-streams-javascript
//Configure Transcription Request
const request_english = {
  config: {
    encoding: "MULAW",
    sampleRateHertz: 8000,
    languageCode: "en-US",
    //speech_contexts: [{
    //  "phrases": [
    //    'Hark', 'hark'
    //  ],
    //  "boost": 20
    //}],
  interimResults: true,
  enableWordTimeOffsets: true,
  enableAutomaticPunctuation: true
  }
};
//JSON message parameters:
/*
Message parameters: {"event":"start","sequenceNumber":"1",
"start":{"accountSid":"ACd82972d0e2258f44c9ceea6ee046a0a4","streamSid":"MZ12b889502f5aa7ba17b161477a671f26",
"callSid":"CAcbce7494a3b91a95dad0512cdf7715c3","tracks":["inbound"],
"mediaFormat":{"encoding":"audio/x-mulaw","sampleRate":8000,"channels":1}},
"streamSid":"MZ12b889502f5aa7ba17b161477a671f26"}
*/

//Global object to keep track of all websocket connections with conversations
var conversation_storage = {}

wss.on("connection", function connection(ws) {
console.log("New Connection Initiated");

 let recognizeStream = null;

 let stream_variables = new Object();
 let updated_prompt = 'The following is a conversation with an AI assistant. The assistant is helpful, creative, clever, and very friendly. Human: Hello, who are you? AI: I am an AI created by OpenAI. How can I help you today?Human: ';
 
   ws.on("message", function incoming(message) {
    const msg = JSON.parse(message);
    
    //Store transcript results in accessible variable
    switch (msg.event) {
      case "connected":
        console.log(`A new call has connected.`);
        
        // Create Stream to the Google Speech to Text API
        recognizeStream = client
          .streamingRecognize(request_english)
          .on("error", console.error)
          .on("data", data => { 
          //Request OpenAI response:
          (async () => {
            const gptResponse = await openai.complete({
                engine: 'davinci',
                prompt: updated_prompt + data.results[0].alternatives[0].transcript + "\nAI:",
                maxTokens: 160,
                temperature: 0.9,
                topP: 1,
                presencePenalty: 0.6,
                frequencyPenalty: 0,
                "stop": ["\n", " Human:", " AI:"],
                bestOf: 1,
                n: 1,
                stream: false
            });
            

            //Example response:
            //{"id":"cmpl-46HuBqDqmBz7LfFRrmRbuD93rTrSw","object":"text_completion","created":1637404143,"model":"davinci:2020-05-03","choices":[{"text":"AI for clothes.","index":0,"logprobs":null,"finish_reason":"stop"}]}
            
            //Say answer
            
            twilio_client.calls(stream_variables.callSid)
            .update({twiml: '<Response><Say>' + gptResponse.data.choices[0].text + '</Say><Pause length="60" /></Response>'}).then(call => console.log(call.to));

            updated_prompt+= data.results[0].alternatives[0].transcript + "\nAI:" + gptResponse.data.choices[0].text + "\nHuman:";
            console.log(updated_prompt);
          })();
            
        });

            //Try out, if update TWIML will end stream and transcription
            //Nope, it doesn't. Stream works just fine
            //Also google send text when detecting a pause, which means for a MVP we don't have to worry abou that.
            
          //});
          
        break;
      case "start":
        //Store streamSid as property to stream
        ws.streamSid = msg.streamSid;
        /*
        console.log(JSON.stringify(msg))
        {"event":"start","sequenceNumber":"1","start":{"accountSid":"ACd82972d0e2258f44c9ceea6ee046a0a4","streamSid":"MZ74acf0a513c915d7f95c1bb1686091d6","callSid":"CAb2f9023980c9e90aa72d85555f8273b7","tracks":["inbound"],"mediaFormat":{"encoding":"audio/x-mulaw","sampleRate":8000,"channels":1}},"streamSid":"MZ74acf0a513c915d7f95c1bb1686091d6"}
        */
        stream_variables.callSid = msg.start.callSid;
        //Create new object in conversation storage for new stream
        //conversation_storage.msg.streamSid = {fromNumber : msg.start.customParameters.number, conversation : ''}
        //console.log(`There are ${conversation_storage.msg.streamSid.length} active calls`);
        break;
      case "media":
        // Write Media Packets to the recognize stream
        recognizeStream.write(msg.media.payload);

        break;
      case "stop":
        console.log(`Call Has Ended`);
        //conversation_storage.
        recognizeStream.destroy();
        break;
    }
  });

});
let ngrok_host = "1552-2003-d4-5721-f100-c29-921b-feb5-f966.ngrok.io"
let stream_twiml = ' \
<Response> \n \
      <Start> \n \
          <Stream name="stream1" url="wss://'+ngrok_host+'" track="inbound_track" /> \n \
      </Start> \n \
      <Say>How can I help you today?</Say> \n \
      <Pause length="10" /> \n \
</Response>';
/**/
//Handle HTTP Request
app.get("/", (req, res) => res.send("Hello World"));

app.post("/", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(stream_twiml);
  console.log(JSON.stringify(req.headers.host));
  console.log(JSON.stringify(req.body));
});


//Dial customer number 
//Test: Three way call possible, if Twilio calls user?

twilio_client.calls
              .create({
                twiml: stream_twiml,
                to: '+4917683358730',
                from: '+441228279000'
              })
             .then(call => console.log(call.sid));
console.log("Listening at Port 8080");
server.listen(8080);

//var stored_number_info = require("./number_storage.json");
//Load storage info from JSon