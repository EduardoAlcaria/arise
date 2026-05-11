package com.automationcenter.dto.machine;

import com.automationcenter.entity.TunnelType;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class MachineResponse {
    private Long id;
    private String name;
    private String host;
    private Integer port;
    private String sshUser;
    private String status;
    private TunnelType tunnelType;
    private String proxyCommand;
    private LocalDateTime lastSeen;
    private LocalDateTime createdAt;
    private Long ownerId;
}
