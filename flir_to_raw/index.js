// Required dependencies (installed via npm in Kudu)
const execFile = require('child_process').execFile;
const exiftool = require('dist-exiftool');
const fs = require('fs');
const im = require('azure-imagemagick');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

// Function triggered by new blob in "uploads" folder
module.exports = function(context, myBlob) {
    var ogtype = context.bindingData.name.split(".")[1];
    var filename = context.bindingData.name.split(".")[0];
    context.log("Converting blob: ", filename+"."+ogtype);

    // Writing blob to function storage to allow command line tools to convert
    fs.writeFile(filename+"."+ogtype, myBlob, function(err) {
        if (err) {
            context.error(err);
            throw "Can't find server, contact TrEnCh-IR team";
        } else {
            context.log("Temp og file was saved to:   ", __dirname + '\\' + filename+"."+ogtype);

            // Pulling metadata from og file
            execFile(exiftool, ['-j', filename+"."+ogtype], (error, stdout, stderr) => {
                
                if (err) {
                    context.error(`exec error: ${error}`);
                    fs.unlink(filename+"."+ogtype, (err) => {
                        if (err) throw err;
                        context.log('successfully deleted ' + filename+"."+ogtype);
                    });
                    throw "Can't open metadata";
                }

                // Formatting metadata variables 
                try{ 
                    var metadata = JSON.parse(stdout);
                    metadata = metadata[0];

                    var bitrange = 65536;
                    var embedtype = metadata.EmbeddedImageType;
                    var pR1 = metadata.PlanckR1;
                    var pR2 = metadata.PlanckR2;
                    var pB = metadata.PlanckB;
                    var pO = metadata.PlanckO;
                    var pF = metadata.PlanckF;

                    // Ends function if no planck constants
                    if(!pR1){ 
                        context.log("No planck constant");
                        fs.unlink(filename+"."+ogtype, (err) => {
                            if (err) throw err;
                            context.log('successfully deleted ' + filename+"."+ogtype);
                        });
                        blockBlobClient.delete();
                        throw "Unsupported filetype. Unable to extract necessary metadata for conversion, no planck constants.";
                    }

                    var rawwidth = metadata.RawThermalImageWidth;
                    var rawheight = metadata.RawThermalImageHeight;
                    var rawtype = metadata.RawThermalImageType;
                    var resolution = rawwidth.toString()+"x"+rawheight.toString();
                    var range = metadata.RawValueRange;
                    var median = metadata.RawValueMedian;
                    var halfRange = range/2;
                    var rawMin = median-halfRange;
                    var rawMax = median+halfRange;
                    var raw25 = (0.25 * (rawMax - rawMin)) + rawMin;
                    var raw50 = (0.5 * (rawMax - rawMin)) + rawMin;
                    var raw75 = (0.75 * (rawMax - rawMin)) + rawMin;
                    var scaleMin = 1*rawMin/bitrange;
                    var scaleMax = 1*rawMax/bitrange;
                    var emis = metadata.Emissivity;
                    var rel_humid = metadata.RelativeHumidity;
                    var aTemp = metadata.AtmosphericTemperature;
                    var rTemp = metadata.ReflectedApparentTemperature;
                    var irwTemp = metadata.IRWindowTemperature;
                    var irt = metadata.IRWindowTransmission;
                    var od = metadata.ObjectDistance;
                    var ata1 = metadata.AtmosphericTransAlpha1;
                    var ata2 = metadata.AtmosphericTransAlpha2;
                    var atb1 = metadata.AtmosphericTransBeta1;
                    var atb2 = metadata.AtmosphericTransBeta2;
                    var atx = metadata.AtmosphericTransX;

                    var emisswind = 1-irt;
                    var reflwind = 0;
                    var h2o = (rel_humid/100)*Math.exp(1.5587+0.06939*(aTemp)-0.00027816*(aTemp*aTemp)+0.00000068455*(aTemp*aTemp)); // relative humidity -> water vapour pressure

                    var tau1 = atx*Math.exp(-Math.sqrt(od/2)*(ata1+atb1*Math.sqrt(h2o)))+(1-atx)*Math.exp(-Math.sqrt(od/2)*(ata2+atb2*Math.sqrt(h2o)));
                    var tau2 = atx*Math.exp(-Math.sqrt(od/2)*(ata1+atb1*Math.sqrt(h2o)))+(1-atx)*Math.exp(-Math.sqrt(od/2)*(ata2+atb2*Math.sqrt(h2o)));

                    var rawrefl1 = pR1/(pR2*(Math.exp(pB/(rTemp+273.15))-pF))+(-1)*pO;
                    var rawrefl1attn = (1-emis)/emis*rawrefl1;
                    var rawatm1 = pR1/(pR2*(Math.exp(pB/(aTemp+273.15))-pF))+(-1)*pO;
                    var rawatm1attn = (1-tau1)/emis/tau1*rawatm1;
                    var rawwind = pR1/(pR2*(Math.exp(pB/(irwTemp+273.15))-pF))+(-1)*pO;
                    var rawwindattn = (emisswind/emis/tau1/irt)*rawwind;
                    var rawrefl2 = pR1/(pR2*(Math.exp(pB/(rTemp+273.15))-pF))+(-1)*pO;
                    var rawrefl2attn = reflwind/emis/tau1/irt*rawrefl2;
                    var rawatm2 = pR1/(pR2*(Math.exp(pB/(aTemp+273.15))-pF))+(-1)*pO;
                    var rawatm2attn = (1-tau2)/emis/tau1/irt/tau2*rawatm2;
                    var rawMinObj = rawMin/emis/tau1/irt/tau2+(-1)*rawatm1attn+(-1)*rawatm2attn+(-1)*rawwindattn+(-1)*rawrefl1attn+(-1)*rawrefl2attn;
                    var rawMaxObj = rawMax/emis/tau1/irt/tau2+(-1)*rawatm1attn+(-1)*rawatm2attn+(-1)*rawwindattn+(-1)*rawrefl1attn+(-1)*rawrefl2attn;
                    var raw25obj = raw25/emis/tau1/irt/tau2+(-1)*rawatm1attn+(-1)*rawatm2attn+(-1)*rawwindattn+(-1)*rawrefl1attn+(-1)*rawrefl2attn;
                    var raw50obj = raw50/emis/tau1/irt/tau2+(-1)*rawatm1attn+(-1)*rawatm2attn+(-1)*rawwindattn+(-1)*rawrefl1attn+(-1)*rawrefl2attn;
                    var raw75obj = raw75/emis/tau1/irt/tau2+(-1)*rawatm1attn+(-1)*rawatm2attn+(-1)*rawwindattn+(-1)*rawrefl1attn+(-1)*rawrefl2attn;
    
                    var tMin = pB/Math.log(pR1/(pR2*(rawMinObj+pO))+pF)-273.15;
                    var tMax = pB/Math.log(pR1/(pR2*(rawMaxObj+pO))+pF)-273.15;

                    var padding = rawwidth+70;
                    var height = rawheight+10;
                    var heightColorBar = rawheight-40;
                    var resize = "18x"+heightColorBar.toString()+"!";
                    var tmax_label = tMax.toString() + " deg"
                    var tmin_label = tMin.toString() + " deg"

                    // Extracting raw thermal image
                    execFile(exiftool, [filename+"."+ogtype, '-b', '-RawThermalImage', '-w', "-rawtemp.tiff"], (err) => {
                        if (err) {
                            context.log(err);
                        }

                        context.log("Temp RAW file was saved to:  ", __dirname + '\\' + filename+"-rawtemp.tiff");

                        context.log("next command: " + filename + "-rawtemp.tiff raw.gray");

                        im.convert([filename+"-rawtemp.tiff", 'gray:'+filename+'.gray'], function(err, stdout){
                            if (err) context.log(err);
                            context.log(stdout);
                            context.log("Converted raw file to gray");

                            var endian = '';
                            if(rawtype=="PNG" || rawtype=="png") endian = 'msb';
                            else if (rawtype=="TIFF" || rawtype=="tiff") endian = 'lsb';
                            else throw "ERROR: Unrecognized raw image type.";

                            im.convert(['-depth', '16', '-endian', endian, '-size', resolution, filename+'.gray', filename+"-RAW.tiff"], function(err, stdout){
                                if (err) {
                                    console.log(err);
                                    throw err;
                                }
                                // Reading in raw thermal image
                                fs.readFile(filename+"-RAW.tiff", (err, rawimg)  => {
                                    if (err) {
                                        context.log(err);
                                        throw "Error reading RawThermalImage. Unsupported filetype.";
                                    }

                                    var vf = '-vf curves=r=\''+scaleMin+'/0 '+scaleMax+'/1\':g=\''+scaleMin+'/0 '+scaleMax+'/1\':b=\''+scaleMin+'/0 '+scaleMax+'/1\', pad='+padding+':'+height+':0:5:black, lut3d=\'Ironbow.cube\'';
                                    context.log(vf);
                                    ffmpeg()
                                        .input(filename + "-RAW.tiff")
                                        .output(filename + "-RGB-iron.tiff")
                                        .on('start', function(stdout, stderr) {
                                            context.log('FFmpeg started!');
                                        })
                                        .on('end', function(stdout, stderr) {
                                            context.log('FFmpeg success!');
                                        })
                                        .on('error', function(err, stdout, stderr) {
                                            context.log('Cannot process: ' + err.message);
                                        });


                                    // Extracting embedded image
                                    execFile(exiftool, [filename+"."+ogtype, '-b', '-EmbeddedImage', '-w', "-EMBED."+embedtype], (error, stdout, stderr) => {
                                        if (err) {context.log("No embedded image...");} 
                                        else     {context.log("Temp embed file was saved to:", __dirname + '\\' + filename+"-EMBED."+embedtype);}
                                        
                                        // Reading in embedded image
                                        fs.readFile(filename+"-EMBED."+embedtype, (err, embeddedimg) => {
                                            if (err) context.log(err);
                                            else context.log("Embedded file successful upload to:  /embed/EMBED-"+filename+"."+ogtype);

                                            // Setting output data
                                            context.bindings.outputembed = embeddedimg;
                                            context.bindings.output = rawimg;
                                            context.bindings.outputog = myBlob;
                                            context.bindings.outputparam = metadata;

                                            context.log("Original file successful upload to:  /originals/"+filename+"."+ogtype);
                                            context.log("RAW file successful upload to:       /raw/RAW-"+filename+"."+ogtype+"."+rawtype);
                                            context.log("Parameter file successful upload to: /param/PARAM-"+filename+"."+ogtype+".json");
                                            

                                            // Deleting local temporary files
                                            fs.unlink(filename+"-EMBED."+embedtype, (err) => {
                                                if (err) context.log(err);
                                                context.log('successfully deleted ' + filename+"-EMBED."+embedtype);
                                            });
                                            fs.unlink(filename+"."+ogtype, (err) => {
                                                if (err) context.log(err);
                                                context.log('successfully deleted ' + filename+"."+ogtype);
                                            });
                                            fs.unlink(filename+"-RAW.tiff", (err) => {
                                                if (err) context.log(err);
                                                context.log('successfully deleted ' + filename+"-RAW.tiff");
                                            });
                                            fs.unlink(filename+'.gray', (err) => {
                                                if (err) context.log(err);
                                                context.log('successfully deleted ' + filename+'.gray');
                                            });
                                            fs.unlink(filename+"-rawtemp.tiff", (err) => {
                                                if (err) context.log(err);
                                                context.log('successfully deleted ' + filename+"-rawtemp.tiff");
                                            });

                                            context.done(); // End of function
                                        });
                                    });
                                });
                            });
                        });
                    });
                } catch(err) {
                    context.log(err.message);
                    context.log("Error caught");
                }
            });
        }
    });
};
