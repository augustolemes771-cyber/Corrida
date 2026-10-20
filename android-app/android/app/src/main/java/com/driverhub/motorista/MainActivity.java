package com.driverhub.motorista;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Modo online nativo (localização em segundo plano)
        registerPlugin(RastreioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
