package com.automationcenter.dto.infisical;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class InfisicalSecret {
    private String secretName;
    private String secretValue;
}
